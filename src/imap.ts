import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import * as fs from "fs";
import * as path from "path";
import type { EmailConfig, EmailSummary, EmailFull, AttachmentInfo } from "./types.js";

function createClient(config: EmailConfig): ImapFlow {
  return new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: config.auth,
    logger: false,
  });
}

// Résout un dossier "spécial" (\Drafts, \Trash, \Junk, \Archive, \Sent) via son
// special-use IMAP, avec repli sur des noms courants (providers hétérogènes).
async function findSpecialFolder(
  client: ImapFlow,
  use: string,
  fallbacks: string[]
): Promise<string> {
  const list = await client.list();
  const special = list.find((f) => f.specialUse === use);
  if (special) return special.path;
  const byName = list.find((f) =>
    fallbacks.some((n) => f.path.toLowerCase().includes(n.toLowerCase()))
  );
  if (byName) return byName.path;
  throw new Error(`Dossier ${use} introuvable (essayés: ${fallbacks.join(", ")}).`);
}

export async function listEmails(
  config: EmailConfig,
  folder: string = "INBOX",
  limit: number = 20,
  unseenOnly: boolean = false
): Promise<EmailSummary[]> {
  const client = createClient(config);
  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      const messages: EmailSummary[] = [];
      const searchCriteria = unseenOnly ? { seen: false } : { all: true };
      const searchResult = await client.search(searchCriteria, { uid: true });
      const uids = Array.isArray(searchResult) ? searchResult : [];

      if (uids.length === 0) return [];

      const selectedUids = uids.slice(-limit);

      for await (const msg of client.fetch(selectedUids, {
        uid: true,
        envelope: true,
        flags: true,
        bodyStructure: true,
      }, { uid: true })) {
        const envelope = msg.envelope;
        if (!envelope) continue;
        const hasAttachments = checkHasAttachments(msg.bodyStructure);
        messages.push({
          uid: msg.uid,
          from: formatAddress(envelope.from),
          to: formatAddress(envelope.to),
          subject: envelope.subject || "(no subject)",
          date: envelope.date?.toISOString() || "",
          seen: msg.flags?.has("\\Seen") ?? false,
          hasAttachments,
        });
      }

      return messages.reverse();
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

export async function readEmail(
  config: EmailConfig,
  uid: number,
  folder: string = "INBOX"
): Promise<EmailFull> {
  const client = createClient(config);
  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      const raw = await client.download(uid.toString(), undefined, { uid: true });
      const parsed = await simpleParser(raw.content);

      const attachments: AttachmentInfo[] = (parsed.attachments || []).map(
        (att, index) => ({
          id: att.contentId || `att-${index}`,
          filename: att.filename || `attachment-${index}`,
          contentType: att.contentType,
          size: att.size,
        })
      );

      return {
        uid,
        from: parsed.from?.text || "",
        to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map(a => a.text).join(", ") : parsed.to.text) : "",
        cc: parsed.cc ? (Array.isArray(parsed.cc) ? parsed.cc.map(a => a.text).join(", ") : parsed.cc.text) : "",
        subject: parsed.subject || "(no subject)",
        date: parsed.date?.toISOString() || "",
        messageId: parsed.messageId || "",
        inReplyTo: parsed.inReplyTo,
        references: Array.isArray(parsed.references)
          ? parsed.references.join(" ")
          : parsed.references || undefined,
        textBody: parsed.text || "",
        htmlBody: parsed.html || "",
        attachments,
      };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

export async function searchEmails(
  config: EmailConfig,
  criteria: {
    from?: string;
    subject?: string;
    since?: string;
    before?: string;
    text?: string;
    folder?: string;
    limit?: number;
  }
): Promise<EmailSummary[]> {
  const client = createClient(config);
  const folder = criteria.folder || "INBOX";
  const limit = criteria.limit || 50;

  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      const query: Record<string, unknown> = {};
      if (criteria.from) query.from = criteria.from;
      if (criteria.subject) query.subject = criteria.subject;
      if (criteria.since) query.since = new Date(criteria.since);
      if (criteria.before) query.before = new Date(criteria.before);
      if (criteria.text) query.body = criteria.text;
      if (Object.keys(query).length === 0) query.all = true;

      const searchResult = await client.search(query, { uid: true });
      const uids = Array.isArray(searchResult) ? searchResult : [];
      if (uids.length === 0) return [];

      const selectedUids = uids.slice(-limit);
      const messages: EmailSummary[] = [];

      for await (const msg of client.fetch(selectedUids, {
        uid: true,
        envelope: true,
        flags: true,
        bodyStructure: true,
      }, { uid: true })) {
        const envelope = msg.envelope;
        if (!envelope) continue;
        messages.push({
          uid: msg.uid,
          from: formatAddress(envelope.from),
          to: formatAddress(envelope.to),
          subject: envelope.subject || "(no subject)",
          date: envelope.date?.toISOString() || "",
          seen: msg.flags?.has("\\Seen") ?? false,
          hasAttachments: checkHasAttachments(msg.bodyStructure),
        });
      }

      return messages.reverse();
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

export async function downloadAttachment(
  config: EmailConfig,
  uid: number,
  attachmentId: string,
  savePath: string,
  folder: string = "INBOX"
): Promise<string> {
  const client = createClient(config);
  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      const raw = await client.download(uid.toString(), undefined, { uid: true });
      const parsed = await simpleParser(raw.content);

      const attachment = parsed.attachments.find(
        (att, index) => (att.contentId || `att-${index}`) === attachmentId
      );

      if (!attachment) {
        throw new Error(`Attachment "${attachmentId}" not found in email UID ${uid}`);
      }

      const resolvedPath = path.resolve(savePath);
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(resolvedPath, attachment.content);
      return resolvedPath;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

// Liste les dossiers/labels de la boîte (pour savoir où classer).
export async function listFolders(config: EmailConfig): Promise<string[]> {
  const client = createClient(config);
  try {
    await client.connect();
    const list = await client.list();
    return list.map((f) => f.path).sort();
  } finally {
    await client.logout();
  }
}

// Crée un brouillon (préparer une réponse). Si replyToUid est fourni, pré-remplit
// destinataire / sujet Re: / en-têtes de threading depuis le message d'origine.
export async function createDraft(
  config: EmailConfig,
  params: {
    to?: string;
    subject?: string;
    body: string;
    cc?: string;
    bcc?: string;
    replyToUid?: number;
    replyAll?: boolean;
    sourceFolder?: string;
  }
): Promise<{ folder: string }> {
  let to = params.to;
  let subject = params.subject;
  let cc = params.cc;
  let inReplyTo: string | undefined;
  let references: string | undefined;

  if (params.replyToUid) {
    const original = await readEmail(
      config,
      params.replyToUid,
      params.sourceFolder || "INBOX"
    );
    to = to || original.from;
    subject =
      subject ||
      (original.subject.startsWith("Re:") ? original.subject : `Re: ${original.subject}`);
    if (params.replyAll && !cc) {
      cc =
        [original.to, original.cc]
          .filter(Boolean)
          .join(", ")
          .split(",")
          .map((a) => a.trim())
          .filter((a) => a && !a.includes(config.auth.user))
          .join(", ") || undefined;
    }
    inReplyTo = original.messageId;
    references = [original.references, original.messageId].filter(Boolean).join(" ");
  }

  const mail = new MailComposer({
    from: config.from,
    to,
    cc,
    bcc: params.bcc,
    subject: subject || "(sans objet)",
    text: params.body,
    inReplyTo,
    references,
  });

  const raw: Buffer = await new Promise((res, rej) =>
    mail.compile().build((err: Error | null, msg: Buffer) => (err ? rej(err) : res(msg)))
  );

  const client = createClient(config);
  try {
    await client.connect();
    const drafts = await findSpecialFolder(client, "\\Drafts", ["Draft", "Brouillon"]);
    await client.append(drafts, raw, ["\\Draft"]);
    return { folder: drafts };
  } finally {
    await client.logout();
  }
}

// Déplace un email vers un dossier/label (classer). Enlève de la source.
export async function moveEmail(
  config: EmailConfig,
  uid: number,
  destination: string,
  folder: string = "INBOX"
): Promise<void> {
  const client = createClient(config);
  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      await client.messageMove(uid.toString(), destination, { uid: true });
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

// Ajoute un label sans retirer de la boîte (copie ; sur Gmail = ajout de label).
export async function copyEmail(
  config: EmailConfig,
  uid: number,
  destination: string,
  folder: string = "INBOX"
): Promise<void> {
  const client = createClient(config);
  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      await client.messageCopy(uid.toString(), destination, { uid: true });
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

// Marque lu / non-lu.
export async function setSeen(
  config: EmailConfig,
  uid: number,
  seen: boolean,
  folder: string = "INBOX"
): Promise<void> {
  const client = createClient(config);
  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      if (seen) {
        await client.messageFlagsAdd(uid.toString(), ["\\Seen"], { uid: true });
      } else {
        await client.messageFlagsRemove(uid.toString(), ["\\Seen"], { uid: true });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

function formatAddress(
  addresses: Array<{ name?: string; address?: string }> | undefined
): string {
  if (!addresses || addresses.length === 0) return "";
  return addresses
    .map((a) => (a.name ? `${a.name} <${a.address}>` : a.address || ""))
    .join(", ");
}

function checkHasAttachments(bodyStructure: unknown): boolean {
  if (!bodyStructure || typeof bodyStructure !== "object") return false;
  const bs = bodyStructure as Record<string, unknown>;
  if (bs.disposition === "attachment") return true;
  if (Array.isArray(bs.childNodes)) {
    return bs.childNodes.some((child: unknown) => checkHasAttachments(child));
  }
  return false;
}
