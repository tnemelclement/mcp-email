import nodemailer from "nodemailer";
import * as fs from "fs";
import * as path from "path";
import type { EmailConfig } from "./types.js";
import { readEmail } from "./imap.js";

function createTransport(config: EmailConfig) {
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.auth,
  });
}

export async function sendEmail(
  config: EmailConfig,
  params: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    attachments?: string[];
  }
): Promise<string> {
  const transport = createTransport(config);

  // Copie cachée systématique vers l'IA elle-même (garde une trace de ce qu'elle envoie)
  const selfCopy = config.auth.user;
  const bcc = [params.bcc, selfCopy].filter(Boolean).join(", ");

  const mailOptions: nodemailer.SendMailOptions = {
    from: config.from,
    to: params.to,
    subject: params.subject,
    text: params.body,
    cc: params.cc,
    bcc,
  };

  if (params.attachments && params.attachments.length > 0) {
    mailOptions.attachments = params.attachments.map((filePath) => {
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) {
        throw new Error(`Attachment file not found: ${resolved}`);
      }
      return {
        filename: path.basename(resolved),
        path: resolved,
      };
    });
  }

  const info = await transport.sendMail(mailOptions);
  return info.messageId;
}

export async function replyEmail(
  config: EmailConfig,
  params: {
    uid: number;
    body: string;
    replyAll?: boolean;
    attachments?: string[];
    folder?: string;
  }
): Promise<string> {
  const original = await readEmail(config, params.uid, params.folder || "INBOX");
  const transport = createTransport(config);

  const subject = original.subject.startsWith("Re:")
    ? original.subject
    : `Re: ${original.subject}`;

  let to = original.from;
  let cc: string | undefined;

  if (params.replyAll) {
    const allRecipients = [original.to, original.cc]
      .filter(Boolean)
      .join(", ")
      .split(",")
      .map((a) => a.trim())
      .filter((a) => a && !a.includes(config.auth.user));
    cc = allRecipients.join(", ") || undefined;
  }

  const references = [original.references, original.messageId]
    .filter(Boolean)
    .join(" ");

  const mailOptions: nodemailer.SendMailOptions = {
    from: config.from,
    to,
    cc,
    bcc: config.auth.user, // copie cachée systématique vers l'IA elle-même
    subject,
    text: params.body,
    inReplyTo: original.messageId,
    references,
  };

  if (params.attachments && params.attachments.length > 0) {
    mailOptions.attachments = params.attachments.map((filePath) => {
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) {
        throw new Error(`Attachment file not found: ${resolved}`);
      }
      return {
        filename: path.basename(resolved),
        path: resolved,
      };
    });
  }

  const info = await transport.sendMail(mailOptions);
  return info.messageId;
}
