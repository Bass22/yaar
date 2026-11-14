# Déployer et garder Yaar

> Le **comment** de l'exploitation : sauvegarder, restaurer (Z.4), mettre en production (Z.5, à compléter). Le **pourquoi** est dans `docs/architecture.md` §9.
>
> **Première installation sur Hetzner, pas à pas** : `docs/installation-hetzner.md`.

## Sauvegarder et restaurer (Z.4)

**Ce qu'est une sauvegarde** (décisions du fondateur du 2026-11-12) : **une seule archive**, `yaar-<date>.tar.age`, qui contient la base (lue d'abord), puis les médias, et un manifeste de leurs empreintes. Elle est **chiffrée pour une clé publique** : le serveur chiffre, mais il ne sait pas déchiffrer. La clé privée reste **chez l'éditeur, hors du serveur**. Un serveur piraté ne livre donc pas les sauvegardes ; une clé privée perdue les rend illisibles à jamais.

### Une fois : la paire de clés

Sur l'ordinateur de l'éditeur, jamais sur le serveur :

```bash
docker build -q -t yaar-age -f infra/docker/age.Dockerfile infra/docker
docker run --rm --entrypoint age-keygen yaar-age > yaar-cle-privee.txt
grep 'public key' yaar-cle-privee.txt     # « age1… » : la clé publique, à donner au serveur
```

- `yaar-cle-privee.txt` va dans un gestionnaire de mots de passe **et** sur un support hors ligne (une clé USB rangée). Elle ne va ni dans le dépôt, ni sur le serveur, ni dans un e-mail.
- La clé publique (`age1…`) n'est pas un secret : elle ne sert qu'à chiffrer.

### Chaque nuit, et avant chaque mise à jour

```bash
BACKUP_RECIPIENT=age1… BACKUP_DIR=/srv/sauvegardes infra/backup/backup.sh
```

- La base d'abord, les médias ensuite : une photo arrivée entre les deux fait au pire un fichier en trop, jamais une ligne sans son fichier. Un envoi de photo en cours (`.tmp`) n'est pas sauvegardé.
- L'archive s'écrit sous un nom provisoire, puis prend son nom définitif une fois complète : une sauvegarde coupée en route ne ressemble jamais à une sauvegarde entière.
- Les archives de **plus de 30 jours** sont retirées (`BACKUP_KEEP_DAYS` pour changer ce nombre).
- Lisibles par leur seul propriétaire (`-rw-------`).

Automatiser, dans la `crontab` de l'utilisateur qui fait tourner la pile, chaque nuit à 2 h — le serveur est réglé en UTC, qui est l'heure de Dakar :

```cron
0 2 * * * cd ~/yaar && BACKUP_RECIPIENT=age1… BACKUP_DIR=/srv/sauvegardes infra/backup/backup.sh >> /srv/sauvegardes/journal.log 2>&1
```

**Une sauvegarde qui reste sur le serveur ne protège pas de la perte du serveur** : chaque archive se copie aussi chez un autre fournisseur (la cible se fixe avec l'hébergeur, Z.5). Elle est chiffrée : cette copie ne demande aucune confiance dans ce fournisseur.

### Restaurer

Sur une **instance vide** seulement : le script refuse une base qui a déjà des tables, ou un volume de médias qui a déjà des fichiers. Il ne remplace jamais rien.

```bash
# sur le nouveau serveur : le dépôt, puis infra/.env (les mêmes secrets que l'ancien, ou de nouveaux)
infra/backup/restore.sh /srv/sauvegardes/yaar-2026-11-12T020000Z.tar.age yaar-cle-privee.txt
```

Il déchiffre, vérifie les empreintes, démarre la base seule (un volume vide crée ses rôles), restaure la base d'un bloc — tout ou rien —, puis les médias, puis démarre toute la pile. La base se restaure sous le superutilisateur, par le socket local de son conteneur : jamais sous un rôle de l'application (réserve R-19). Une fois la restauration finie, **effacer la clé privée de ce serveur**.

**La preuve** : `infra/backup/backup-restore.test.sh` monte une vraie pile, y met des données et une photo, la sauvegarde, la détruit volumes compris, la restaure, et vérifie les mêmes chiffres table par table, les mêmes médias, la sécurité par ligne revenue et l'API de nouveau prête. À rejouer après tout changement du schéma ou des scripts.

## Copier les sauvegardes hors du serveur

**Pour commencer (décision du fondateur du 2026-11-13) : sur l'ordinateur du fondateur.** C'est l'ordinateur qui vient chercher les archives : le serveur ne détient aucun accès à cet ordinateur. Les archives sont chiffrées, elles ne s'ouvrent qu'avec la clé privée.

```bash
# sur l'ordinateur du fondateur (macOS ou Linux), avec la clé SSH qui ouvre le serveur
rsync -a --ignore-existing yaar@IP_DU_SERVEUR:/srv/sauvegardes/ ~/Sauvegardes-Yaar/
```

À lancer chaque matin, à la main ou par une tâche planifiée de l'ordinateur (`crontab -e` : `30 8 * * * rsync -a --ignore-existing yaar@IP_DU_SERVEUR:/srv/sauvegardes/ ~/Sauvegardes-Yaar/`). Limite : un ordinateur éteint plusieurs jours, et les sauvegardes de ces jours n'existent que sur le serveur. Le serveur en garde 30 jours : le prochain passage rattrape tout.

**Plus tard, deux solutions automatiques** (à choisir quand le pilote s'élargit) :
- **Hetzner Storage Box**, dans un autre centre de données que le serveur (par exemple serveur en Allemagne, stockage en Finlande) : environ 4 € par mois, copie par `rsync` sur SSH depuis le serveur, aucun outil de plus. Protège de la perte du serveur, pas d'un problème de compte chez Hetzner.
- **OVH Object Storage**, chez un autre fournisseur : protège aussi d'un problème de compte chez l'hébergeur du serveur ; demande `rclone` sur le serveur et une paire de clés d'accès.

Dans les deux cas, l'archive reste chiffrée : le fournisseur ne lit rien.

## Mettre en production (Z.5)

**Hébergement visé (2026-11-13)** : Hetzner (OVHcloud en repli si le compte n'est pas accepté). Un serveur Linux (Ubuntu 24.04 ou Debian 12), 2 processeurs, 4 Go de mémoire, 40 Go de disque — de quoi construire les images sur place.

### 1. Le serveur

1. Créer le serveur, avec une **clé SSH** (jamais de mot de passe). Dans le pare-feu de l'hébergeur, n'ouvrir que **22** (SSH), **80** et **443**. Le port 80 reste ouvert : Let's Encrypt passe par lui pour vérifier le domaine, puis Caddy y renvoie vers le HTTPS.
2. Chez le registraire du domaine : un enregistrement **A** de `app.ton-domaine` vers l'adresse IP du serveur.
3. Sur le serveur, en `root` une seule fois :

```bash
apt-get update && apt-get -y upgrade && apt-get -y install git
curl -fsSL https://get.docker.com | sh            # Docker et son compose, de la source officielle
adduser --disabled-password yaar && usermod -aG docker yaar
mkdir -p /srv/sauvegardes && chown yaar:yaar /srv/sauvegardes && chmod 700 /srv/sauvegardes
timedatectl set-timezone UTC                      # l'heure de Dakar
```

### 2. La pile

En `yaar` :

```bash
git clone <adresse du dépôt> ~/yaar && cd ~/yaar
cp infra/.env.example infra/.env && chmod 600 infra/.env
openssl rand -hex 32    # trois fois : DB_PASSWORD, APP_DB_PASSWORD, JWT_SECRET, à coller dans infra/.env
node tools/vapid-keys.mjs   # les deux lignes des notifications (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY), à coller aussi, avec VAPID_SUBJECT=https://ton-domaine : sans les trois, rien n'est proposé ni envoyé ; changer la paire désabonne tous les appareils
# et dans infra/.env : SITE_ADDRESS=app.ton-domaine
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml up -d --build --wait
```

Puis amorcer l'élevage (le PIN est demandé au clavier, jamais en argument) :

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml run --rm -it migrate \
  node dist/bootstrap-tenant.js --tenant "…" --site "…" --time-zone Africa/Dakar --admin-name "…" --admin-phone +221…
```

Ouvrir `https://app.ton-domaine` : le certificat est déjà là. **`infra/.env` ne quitte jamais le serveur** ; en garder une copie dans le gestionnaire de mots de passe (sans ces secrets, une restauration sur un nouveau serveur demande d'en créer de nouveaux, et tout le monde se reconnecte).

### 3. Les sauvegardes

La clé publique et la tâche de la nuit : voir « Sauvegarder et restaurer » plus haut. En production, les scripts doivent connaître la surcouche — sans elle, une restauration redémarrerait la pile sans HTTPS : on la leur donne par `COMPOSE_FILE`, dans la `crontab` comme à la main :

```cron
0 2 * * * cd ~/yaar && COMPOSE_FILE=infra/docker-compose.yml:infra/docker-compose.prod.yml BACKUP_RECIPIENT=age1… BACKUP_DIR=/srv/sauvegardes infra/backup/backup.sh >> /srv/sauvegardes/journal.log 2>&1
```

Puis la copie vers l'ordinateur du fondateur.

### 4. Mettre à jour

```bash
cd ~/yaar
COMPOSE_FILE=infra/docker-compose.yml:infra/docker-compose.prod.yml BACKUP_RECIPIENT=age1… BACKUP_DIR=/srv/sauvegardes infra/backup/backup.sh   # toujours d'abord
git pull
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml up -d --build --wait
```

Les migrations passent avant que l'API ne redémarre. Les téléphones prennent la nouvelle version **sans rien demander** : à l'ouverture de l'application, ou quand elle revient au premier plan, jamais pendant un geste (une feuille ouverte, ou le curseur dans une case).

### 5. Changer un secret

Aucun secret ne touche aux données : les changer ne perd rien. Mais un mot de passe de la base se change **d'abord dans la base**, puis dans `infra/.env` — changer le fichier seul couperait l'API de sa base. Le script fait les trois pas, tire une valeur au hasard, ne l'affiche jamais, et redémarre la pile :

```bash
cd ~/yaar
export COMPOSE_FILE=infra/docker-compose.yml:infra/docker-compose.prod.yml
infra/rotate-secret.sh app      # APP_DB_PASSWORD, le compte de l'API
infra/rotate-secret.sh owner    # DB_PASSWORD, le propriétaire des tables (migrations, scripts)
infra/rotate-secret.sh jwt      # JWT_SECRET : tout le monde se reconnecte avec son PIN
```

Puis recopier `infra/.env` dans le gestionnaire de mots de passe. La clé des sauvegardes, elle, se change en créant une nouvelle paire de clés et en remplaçant `BACKUP_RECIPIENT` dans la `crontab` ; **garder l'ancienne clé privée 30 jours**, le temps que les archives qu'elle ouvre sortent de la rotation.

**Quand changer quoi** (recommandations de l'ANSSI et du NIST : on change sur un événement, pas sur un calendrier — un changement forcé tous les trois mois pousse aux secrets faibles et aux post-it) :

| Secret | Quand le changer | Ce que ça coûte |
|---|---|---|
| PIN d'un gardien ou de l'admin | **Jamais par calendrier.** Téléphone perdu, volé ou prêté, PIN vu par quelqu'un, départ de la personne : l'admin bloque le compte (tous ses appareils sont déconnectés) puis donne un PIN provisoire | La personne choisit un nouveau PIN |
| `APP_DB_PASSWORD`, `DB_PASSWORD` | **Une fois par an**, et **aussitôt** si quelqu'un qui a eu accès au serveur part, ou au moindre soupçon (copie de `infra/.env` égarée, serveur douteux) | Une minute d'interruption, en heure creuse |
| `JWT_SECRET` | **Une fois par an**, et aussitôt au moindre soupçon | Tout le monde se reconnecte : à faire le soir, pas en pleine journée de terrain |
| Clé des sauvegardes (`age`) | Si la clé privée a pu être copiée, ou si quelqu'un qui l'avait part | Garder l'ancienne clé privée 30 jours |
| Clé SSH du serveur | Ordinateur perdu ou volé, départ de quelqu'un qui l'avait | Retirer l'ancienne clé de `~/.ssh/authorized_keys` |
| Images de base | **Une fois par mois** (voir plus bas) | Rejouer les deux tests de `infra/` |

Un rappel annuel dans l'agenda du fondateur suffit pour les secrets de la pile ; tout le reste se déclenche sur un événement.

### Ce que la production garantit, et sa preuve

`infra/production.test.sh` monte la pile avec la surcouche de production et vérifie : HTTPS, HSTS sur les pages et sur l'API, politique de contenu stricte, ni encadrement ni nom de serveur, le HTTP renvoyé vers le HTTPS ; la sonde qui interroge la base **fermée à Internet** (R-9) alors que l'API est prête ; le certificat gardé quand le conteneur est recréé ; aucun secret dans une image ni fichier `.env` ; aucun mot de passe dans le journal de la base (R-10) ; seul le web publie des ports, 80 et 443 ; toute image de base épinglée par son empreinte (R-10) ; et le changement des trois secrets — l'ancien mot de passe refusé par la base depuis le réseau interne, le nouveau accepté, l'API de nouveau prête, la valeur jamais affichée, le fichier lisible par son seul propriétaire, les données intactes. À rejouer avant chaque mise en production.

**Monter une image de base** (une empreinte épinglée ne reçoit plus de correctif de sécurité d'elle-même) : une fois par mois, relever les nouvelles empreintes (`docker buildx imagetools inspect node:22-slim`…), les reporter dans les `Dockerfile` et le compose, rejouer les deux tests de `infra/`.
