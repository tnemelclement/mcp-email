#!/usr/bin/env python3
"""Renseigne le mot de passe d'un compte dans .env sans l'afficher.
Usage: python3 set-password.py <compte>
Saisie masquée (getpass) — le mot de passe n'apparaît ni à l'écran ni dans l'historique shell."""
import json, sys, getpass, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
ACCOUNTS = os.path.join(HERE, "accounts.json")
ENV = os.path.join(HERE, ".env")

if len(sys.argv) != 2:
    sys.exit("Usage: python3 set-password.py <compte>  (la clé dans accounts.json)")

name = sys.argv[1]
with open(ACCOUNTS) as f:
    data = json.load(f)

if name not in data.get("accounts", {}):
    sys.exit(f"Compte inconnu: {name}. Dispo: {', '.join(data['accounts'])}")

var = "EMAIL_PASS_" + re.sub(r"[^A-Z0-9]", "_", name.upper())
user = data["accounts"][name]["user"]
pw = getpass.getpass(f"Mot de passe d'application pour '{name}' ({user}): ")
if not pw.strip():
    sys.exit("Vide, annulé.")

# Toujours quoter : un mot de passe contenant $ ou % est sinon tronqué en silence
# par l'interpolation (shell, docker compose) — la panne est une auth qui échoue sans raison.
quoted = f"'{pw}'" if "'" not in pw else '"' + pw.replace("\\", "\\\\").replace('"', '\\"') + '"'

lines = open(ENV).read().splitlines() if os.path.exists(ENV) else []
for i, line in enumerate(lines):
    if line.startswith(var + "="):
        lines[i] = f"{var}={quoted}"
        break
else:
    lines += [f"# {user}", f"{var}={quoted}"]

with open(ENV, "w") as f:
    f.write("\n".join(lines) + "\n")
os.chmod(ENV, 0o600)
print(f"OK, {var} enregistré dans .env.")
