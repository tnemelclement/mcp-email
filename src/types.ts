import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

export interface EmailConfig {
  imap: {
    host: string;
    port: number;
    secure: boolean;
  };
  smtp: {
    host: string;
    port: number;
    secure: boolean;
  };
  auth: {
    user: string;
    pass: string;
  };
  from: string;
}

export interface EmailSummary {
  uid: number;
  from: string;
  to: string;
  subject: string;
  date: string;
  seen: boolean;
  hasAttachments: boolean;
}

export interface EmailFull {
  uid: number;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  messageId: string;
  inReplyTo?: string;
  references?: string;
  textBody: string;
  htmlBody: string;
  attachments: AttachmentInfo[];
}

export interface AttachmentInfo {
  id: string;
  filename: string;
  contentType: string;
  size: number;
}

// Une entrée de accounts.json (format plat, plus lisible pour l'humain qui édite)
interface AccountEntry {
  imap_host: string;
  imap_port?: number;
  smtp_host: string;
  smtp_port?: number;
  user: string;
  /** Optionnel : le mot de passe vit dans .env (EMAIL_PASS_<COMPTE>), pas ici. */
  pass?: string;
  from?: string;
}

/** Nom de la variable d'env portant le mot de passe d'un compte. */
export function passEnvVar(account: string): string {
  return "EMAIL_PASS_" + account.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

interface AccountsFile {
  default?: string;
  accounts: Record<string, AccountEntry>;
}

export interface Accounts {
  configs: Record<string, EmailConfig>;
  default: string;
}

function entryToConfig(name: string, e: AccountEntry): EmailConfig {
  const imap_port = e.imap_port ?? 993;
  const smtp_port = e.smtp_port ?? 465;
  // Le mot de passe vient de .env ; le champ "pass" du JSON reste un fallback legacy.
  const envVar = passEnvVar(name);
  const pass = process.env[envVar] || e.pass;
  if (!pass) {
    throw new Error(
      `Mot de passe manquant pour le compte "${name}" : définissez ${envVar} dans .env ` +
        `(python3 set-password.py ${name}).`
    );
  }
  return {
    imap: { host: e.imap_host, port: imap_port, secure: imap_port === 993 },
    // secure=true seulement en 465 (SSL implicite) ; 587 => STARTTLS (secure:false)
    smtp: { host: e.smtp_host, port: smtp_port, secure: smtp_port === 465 },
    auth: { user: e.user, pass },
    from: e.from || e.user,
  };
}

// Charge tous les comptes depuis accounts.json (structure) + .env (mots de passe).
export function loadAccounts(): Accounts {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(__dirname, "..");
  // n'écrase pas les variables déjà présentes (docker env_file, shell, CI)
  dotenv.config({ path: path.join(root, ".env"), quiet: true });

  const file = path.join(root, "accounts.json");
  if (!fs.existsSync(file)) {
    throw new Error(
      `accounts.json introuvable (${file}). Copiez accounts.json.example et remplissez-le.`
    );
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as AccountsFile;
  const names = Object.keys(parsed.accounts || {});
  if (names.length === 0) throw new Error("accounts.json ne contient aucun compte.");

  const configs: Record<string, EmailConfig> = {};
  for (const name of names) configs[name] = entryToConfig(name, parsed.accounts[name]);

  const def = parsed.default && configs[parsed.default] ? parsed.default : names[0];
  return { configs, default: def };
}
