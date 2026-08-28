#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadAccounts, type EmailConfig } from "./types.js";
import {
  listEmails,
  readEmail,
  searchEmails,
  downloadAttachment,
  listFolders,
  createDraft,
  moveEmail,
  copyEmail,
  setSeen,
} from "./imap.js";
import { sendEmail, replyEmail } from "./smtp.js";

const { configs, default: defaultAccount } = loadAccounts();
const accountNames = Object.keys(configs) as [string, ...string[]];

// enum Zod du paramètre account, présent sur chaque outil
const accountParam = z
  .enum(accountNames)
  .optional()
  .describe(`Compte à utiliser (${accountNames.join(", ")}). Défaut: ${defaultAccount}`);

function pick(account?: string): EmailConfig {
  const name = account || defaultAccount;
  const config = configs[name];
  if (!config) throw new Error(`Compte inconnu: ${name}. Disponibles: ${accountNames.join(", ")}`);
  return config;
}

function fail(error: unknown) {
  return {
    content: [
      { type: "text" as const, text: `Erreur: ${error instanceof Error ? error.message : String(error)}` },
    ],
    isError: true,
  };
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function fmtList(emails: Awaited<ReturnType<typeof listEmails>>): string {
  return emails
    .map(
      (e) =>
        `[UID:${e.uid}] ${e.seen ? " " : "*"} ${e.date.slice(0, 10)} | ${e.from} | ${e.subject}${e.hasAttachments ? " [PJ]" : ""}`
    )
    .join("\n");
}

const server = new McpServer({ name: "email", version: "2.0.0" });

// Tool: list_accounts
server.tool(
  "list_accounts",
  "Lister les comptes email configurés",
  {},
  async () =>
    ok(
      `Comptes disponibles:\n${accountNames
        .map((n) => `- ${n}${n === defaultAccount ? " (défaut)" : ""}: ${configs[n].auth.user}`)
        .join("\n")}`
    )
);

// Tool: send_email
server.tool(
  "send_email",
  "Envoyer un email avec pieces jointes optionnelles",
  {
    account: accountParam,
    to: z.string().describe("Destinataire(s), separes par des virgules"),
    subject: z.string().describe("Objet de l'email"),
    body: z.string().describe("Corps du message (texte brut)"),
    cc: z.string().optional().describe("Copie carbone (CC)"),
    bcc: z.string().optional().describe("Copie carbone invisible (BCC)"),
    attachments: z.array(z.string()).optional().describe("Chemins locaux des pieces jointes"),
  },
  async ({ account, ...params }) => {
    try {
      const messageId = await sendEmail(pick(account), params);
      return ok(
        `Email envoye (${account || defaultAccount}).\nMessage-ID: ${messageId}\nDestinataire: ${params.to}\nObjet: ${params.subject}`
      );
    } catch (error) {
      return fail(error);
    }
  }
);

// Tool: list_emails
server.tool(
  "list_emails",
  "Lister les emails d'un dossier (inbox par defaut)",
  {
    account: accountParam,
    folder: z.string().optional().default("INBOX").describe("Dossier IMAP (defaut: INBOX)"),
    limit: z.number().optional().default(20).describe("Nombre max d'emails (defaut: 20)"),
    unseen_only: z.boolean().optional().default(false).describe("Uniquement les non-lus"),
  },
  async ({ account, folder, limit, unseen_only }) => {
    try {
      const emails = await listEmails(pick(account), folder, limit, unseen_only);
      if (emails.length === 0) return ok("Aucun email trouve.");
      return ok(`${emails.length} email(s) dans ${folder} (${account || defaultAccount}):\n\n${fmtList(emails)}`);
    } catch (error) {
      return fail(error);
    }
  }
);

// Tool: read_email
server.tool(
  "read_email",
  "Lire le contenu complet d'un email",
  {
    account: accountParam,
    uid: z.number().describe("UID de l'email"),
    folder: z.string().optional().default("INBOX").describe("Dossier IMAP"),
  },
  async ({ account, uid, folder }) => {
    try {
      const email = await readEmail(pick(account), uid, folder);
      let text = `De: ${email.from}\nA: ${email.to}`;
      if (email.cc) text += `\nCC: ${email.cc}`;
      text += `\nObjet: ${email.subject}\nDate: ${email.date}\nMessage-ID: ${email.messageId}`;
      text += `\n\n--- Corps ---\n${email.textBody || "(pas de contenu texte)"}`;
      if (email.attachments.length > 0) {
        text += `\n\n--- Pieces jointes (${email.attachments.length}) ---`;
        email.attachments.forEach((att) => {
          text += `\n- [${att.id}] ${att.filename} (${att.contentType}, ${formatSize(att.size)})`;
        });
      }
      return ok(text);
    } catch (error) {
      return fail(error);
    }
  }
);

// Tool: search_emails
server.tool(
  "search_emails",
  "Rechercher des emails par criteres",
  {
    account: accountParam,
    from: z.string().optional().describe("Filtrer par expediteur"),
    subject: z.string().optional().describe("Filtrer par objet"),
    since: z.string().optional().describe("Emails depuis cette date (YYYY-MM-DD)"),
    before: z.string().optional().describe("Emails avant cette date (YYYY-MM-DD)"),
    text: z.string().optional().describe("Recherche dans le corps du message"),
    folder: z.string().optional().default("INBOX").describe("Dossier IMAP"),
    limit: z.number().optional().default(50).describe("Nombre max de resultats"),
  },
  async ({ account, ...criteria }) => {
    try {
      const emails = await searchEmails(pick(account), criteria);
      if (emails.length === 0) return ok("Aucun email correspondant.");
      return ok(`${emails.length} resultat(s) (${account || defaultAccount}):\n\n${fmtList(emails)}`);
    } catch (error) {
      return fail(error);
    }
  }
);

// Tool: download_attachment
server.tool(
  "download_attachment",
  "Telecharger une piece jointe d'un email",
  {
    account: accountParam,
    uid: z.number().describe("UID de l'email"),
    attachment_id: z.string().describe("ID de la piece jointe (depuis read_email)"),
    save_path: z.string().describe("Chemin de sauvegarde local"),
    folder: z.string().optional().default("INBOX").describe("Dossier IMAP"),
  },
  async ({ account, uid, attachment_id, save_path, folder }) => {
    try {
      const savedPath = await downloadAttachment(pick(account), uid, attachment_id, save_path, folder);
      return ok(`Piece jointe sauvegardee: ${savedPath}`);
    } catch (error) {
      return fail(error);
    }
  }
);

// Tool: reply_email
server.tool(
  "reply_email",
  "Repondre a un email existant (envoi immediat)",
  {
    account: accountParam,
    uid: z.number().describe("UID de l'email auquel repondre"),
    body: z.string().describe("Corps de la reponse (texte brut)"),
    reply_all: z.boolean().optional().default(false).describe("Repondre a tous (defaut: false)"),
    attachments: z.array(z.string()).optional().describe("Chemins locaux des pieces jointes"),
    folder: z.string().optional().default("INBOX").describe("Dossier IMAP"),
  },
  async ({ account, uid, body, reply_all, attachments, folder }) => {
    try {
      const messageId = await replyEmail(pick(account), { uid, body, replyAll: reply_all, attachments, folder });
      return ok(`Reponse envoyee (${account || defaultAccount}).\nMessage-ID: ${messageId}`);
    } catch (error) {
      return fail(error);
    }
  }
);

// Tool: create_draft — preparer une reponse (brouillon, pas d'envoi)
server.tool(
  "create_draft",
  "Preparer un brouillon (reponse a preparer). Depose dans le dossier Brouillons, visible dans ton client mail. Pour repondre a un email existant, fournir reply_to_uid.",
  {
    account: accountParam,
    body: z.string().describe("Corps du brouillon (texte brut)"),
    to: z.string().optional().describe("Destinataire(s) — auto-rempli si reply_to_uid"),
    subject: z.string().optional().describe("Objet — auto-rempli (Re:) si reply_to_uid"),
    cc: z.string().optional().describe("Copie carbone"),
    bcc: z.string().optional().describe("Copie cachee"),
    reply_to_uid: z.number().optional().describe("UID de l'email auquel ce brouillon repond"),
    reply_all: z.boolean().optional().default(false).describe("Inclure tous les destinataires en CC"),
    source_folder: z.string().optional().default("INBOX").describe("Dossier du message d'origine"),
  },
  async ({ account, body, to, subject, cc, bcc, reply_to_uid, reply_all, source_folder }) => {
    try {
      const { folder } = await createDraft(pick(account), {
        body,
        to,
        subject,
        cc,
        bcc,
        replyToUid: reply_to_uid,
        replyAll: reply_all,
        sourceFolder: source_folder,
      });
      return ok(`Brouillon cree dans "${folder}" (${account || defaultAccount}).`);
    } catch (error) {
      return fail(error);
    }
  }
);

// Tool: move_email — classer (deplace vers un dossier/label)
server.tool(
  "move_email",
  "Classer un email : le deplacer vers un dossier/label (retire de la source). Utiliser list_folders pour connaitre les dossiers.",
  {
    account: accountParam,
    uid: z.number().describe("UID de l'email"),
    destination: z.string().describe("Dossier/label de destination"),
    folder: z.string().optional().default("INBOX").describe("Dossier source"),
  },
  async ({ account, uid, destination, folder }) => {
    try {
      await moveEmail(pick(account), uid, destination, folder);
      return ok(`Email ${uid} deplace vers "${destination}".`);
    } catch (error) {
      return fail(error);
    }
  }
);

// Tool: label_email — ajouter un label sans retirer de la boite (Gmail)
server.tool(
  "label_email",
  "Ajouter un label/copier un email dans un dossier SANS le retirer de la source (sur Gmail = ajout de label).",
  {
    account: accountParam,
    uid: z.number().describe("UID de l'email"),
    destination: z.string().describe("Label/dossier a ajouter"),
    folder: z.string().optional().default("INBOX").describe("Dossier source"),
  },
  async ({ account, uid, destination, folder }) => {
    try {
      await copyEmail(pick(account), uid, destination, folder);
      return ok(`Email ${uid} ajoute a "${destination}".`);
    } catch (error) {
      return fail(error);
    }
  }
);

// Tool: mark_email — marquer lu / non-lu
server.tool(
  "mark_email",
  "Marquer un email comme lu ou non-lu",
  {
    account: accountParam,
    uid: z.number().describe("UID de l'email"),
    seen: z.boolean().describe("true = lu, false = non-lu"),
    folder: z.string().optional().default("INBOX").describe("Dossier IMAP"),
  },
  async ({ account, uid, seen, folder }) => {
    try {
      await setSeen(pick(account), uid, seen, folder);
      return ok(`Email ${uid} marque ${seen ? "lu" : "non-lu"}.`);
    } catch (error) {
      return fail(error);
    }
  }
);

// Tool: list_folders
server.tool(
  "list_folders",
  "Lister les dossiers/labels d'un compte",
  { account: accountParam },
  async ({ account }) => {
    try {
      const folders = await listFolders(pick(account));
      return ok(`Dossiers (${account || defaultAccount}):\n${folders.map((f) => `- ${f}`).join("\n")}`);
    } catch (error) {
      return fail(error);
    }
  }
);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
