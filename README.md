# MCP Email

Serveur MCP pour lire, envoyer, classer et rechercher des emails depuis un
assistant IA, sur plusieurs boîtes à la fois. Fonctionne avec n'importe quel
fournisseur IMAP/SMTP : Gmail, Yahoo, Infomaniak, OVH, un serveur d'entreprise.

Douze outils, une seule configuration, autant de comptes que vous voulez.

## Avertissement

Ce serveur donne à un assistant IA l'accès en lecture **et en écriture** à vos
boîtes mail. Il peut lire vos messages, en envoyer et en déplacer.

Trois précautions, dans l'ordre d'importance :

1. **Utilisez un mot de passe d'application**, jamais celui de votre compte.
   Il se révoque en un clic sans changer votre mot de passe principal.
2. **Commencez par un compte secondaire** le temps de prendre vos marques.
3. **Relisez avant d'envoyer.** L'outil `create_draft` prépare un brouillon
   sans l'envoyer : préférez-le à `send_email` quand le message compte.

Le fichier `.env` contenant vos mots de passe n'est jamais versionné, et
`set-password.py` les saisit sans les afficher ni les laisser dans
l'historique du shell.

## Installation

```bash
git clone https://github.com/tnemelclement/mcp-email.git
cd mcp-email
npm install
```

Node 18 ou plus récent. Aucune compilation : le serveur tourne via `tsx`
directement sur les sources.

## Configuration

Deux fichiers, séparés volontairement : la structure d'un côté, les mots de
passe de l'autre.

### 1. Vos boîtes

```bash
cp accounts.json.example accounts.json
```

Un bloc par boîte. La clé (`perso`, `pro`) est le nom court que vous utiliserez
ensuite dans le paramètre `account` de chaque outil.

```json
{
  "default": "perso",
  "accounts": {
    "perso": {
      "imap_host": "imap.gmail.com",
      "imap_port": 993,
      "smtp_host": "smtp.gmail.com",
      "smtp_port": 587,
      "user": "vous@gmail.com",
      "from": "Votre Nom <vous@gmail.com>"
    }
  }
}
```

`from` est facultatif : sans lui, `user` est utilisé comme expéditeur.
`imap_port` vaut 993 par défaut, `smtp_port` vaut 465.

Le chiffrement est déduit du port, sans réglage supplémentaire : 465 en SSL
direct, 587 en STARTTLS.

### 2. Vos mots de passe

```bash
python3 set-password.py perso
```

La saisie est masquée, le mot de passe est écrit dans `.env` en permissions
`600`, et il n'apparaît jamais à l'écran ni dans l'historique du shell.

Vous pouvez aussi éditer `.env` à la main, en suivant `.env.example`. Une
variable `EMAIL_PASS_<COMPTE>` par compte, en majuscules.

> **Mots de passe d'application** : [Gmail](https://myaccount.google.com/apppasswords),
> [Yahoo](https://login.yahoo.com/account/security),
> [iCloud](https://account.apple.com/account/manage). Ils sont obligatoires dès
> que la validation en deux étapes est active.

### Paramètres par fournisseur

Les valeurs ci-dessous sont celles publiées par chaque fournisseur. En cas de
doute, cherchez « IMAP » dans l'aide de votre messagerie : le port 993 en
réception et 587 ou 465 en envoi sont des standards.

| Fournisseur | IMAP | SMTP | Mot de passe |
|---|---|---|---|
| **Gmail** | `imap.gmail.com` · 993 | `smtp.gmail.com` · 587 | mot de passe d'application obligatoire |
| **iCloud** | `imap.mail.me.com` · 993 | `smtp.mail.me.com` · 587 | mot de passe d'application obligatoire |
| **Yahoo** | `imap.mail.yahoo.com` · 993 | `smtp.mail.yahoo.com` · 465 | mot de passe d'application obligatoire |
| **Infomaniak** | `mail.infomaniak.com` · 993 | `mail.infomaniak.com` · 587 | mot de passe du compte |
| **OVH** | `ssl0.ovh.net` · 993 | `ssl0.ovh.net` · 587 | mot de passe du compte |

L'identifiant est **toujours l'adresse email complète**, jamais le seul nom
d'utilisateur.

#### Gmail

Le mot de passe d'application exige la validation en deux étapes activée. Une
fois généré, collez les seize caractères **sans les espaces**.

Si l'accès IMAP a été désactivé sur le compte, réactivez-le dans les réglages
Gmail, onglet « Transfert et POP/IMAP ».

#### iCloud

Le nom d'utilisateur est la partie **avant le @** de votre adresse iCloud, pas
l'adresse entière. C'est la cause d'échec la plus fréquente sur ce
fournisseur.

#### Outlook, Hotmail et Microsoft 365

**Ces comptes ne fonctionnent pas avec ce serveur.** Microsoft a supprimé
l'authentification par mot de passe pour IMAP et SMTP dans Exchange Online, au
profit d'OAuth 2.0 exclusivement. Un serveur qui s'authentifie par mot de
passe, comme celui-ci, est donc refusé.

Voir l'[annonce Microsoft](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/deprecation-of-basic-authentication-exchange-online).
La prise en charge d'OAuth 2.0 n'est pas implémentée à ce jour.

#### Serveur d'entreprise

Demandez à votre administrateur l'hôte IMAP, l'hôte SMTP et les ports. Sur
beaucoup de serveurs, le port 587 utilise STARTTLS et le 465 un chiffrement
direct : les deux sont gérés automatiquement selon le port indiqué.

### 3. Le branchement à l'assistant

**Claude Code** :

```bash
claude mcp add email -- npx tsx /chemin/absolu/vers/mcp-email/src/index.ts
```

**Claude Desktop**, dans `claude_desktop_config.json` :

```json
{
  "mcpServers": {
    "email": {
      "command": "npx",
      "args": ["tsx", "/chemin/absolu/vers/mcp-email/src/index.ts"],
      "cwd": "/chemin/absolu/vers/mcp-email"
    }
  }
}
```

Le chemin doit être **absolu**, et `cwd` est nécessaire pour que le serveur
trouve `accounts.json` et `.env`.

> Si votre Node par défaut est ancien, donnez le chemin complet d'un binaire
> récent, par exemple `/opt/homebrew/opt/node@24/bin/npx` sur macOS.

## Les outils

Chaque outil accepte un paramètre `account` facultatif. Sans lui, le compte
`default` de `accounts.json` est utilisé.

| Outil | Rôle |
|---|---|
| `list_accounts` | Lister les comptes configurés |
| `list_folders` | Lister les dossiers d'une boîte |
| `list_emails` | Lister les messages d'un dossier |
| `read_email` | Lire un message complet |
| `search_emails` | Chercher par expéditeur, sujet, date, statut |
| `send_email` | Envoyer, avec pièces jointes |
| `reply_email` | Répondre en conservant le fil |
| `create_draft` | Préparer un brouillon **sans envoyer** |
| `move_email` | Déplacer vers un dossier |
| `label_email` | Copier dans un dossier sans retirer de l'origine |
| `mark_email` | Marquer lu ou non lu |
| `download_attachment` | Télécharger une pièce jointe |

## Résolution des pannes

**L'authentification échoue alors que le mot de passe est correct.**
Vérifiez qu'il s'agit bien d'un mot de passe d'application. Vérifiez aussi
qu'il est entre guillemets dans `.env` : un mot de passe contenant `$` ou `%`
est sinon tronqué en silence. `set-password.py` s'en charge automatiquement.

**Le serveur ne démarre pas.**
Le chemin dans la configuration doit être absolu, et `cwd` doit pointer sur le
dossier du projet, sinon `accounts.json` reste introuvable.

**Un dossier IMAP est introuvable.**
Les noms varient selon les fournisseurs (`Sent`, `Messages envoyés`,
`[Gmail]/Messages envoyés`). Passez par `list_folders` pour obtenir les noms
exacts de votre boîte.

## Licence

MIT
