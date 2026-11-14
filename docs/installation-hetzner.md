# Installer Yaar sur Hetzner, pas à pas

> Le guide pratique du fondateur pour une première mise en production. Le **pourquoi** de chaque choix, et les gestes d'après (mettre à jour, changer un secret, restaurer), sont dans `docs/deploiement.md`. Compter **une heure à une heure et demie** la première fois, la propagation du domaine comprise.

## 0. Avant de commencer

Il te faut :

- un **compte Hetzner Cloud** validé (https://console.hetzner.cloud — une pièce d'identité ou un premier paiement peuvent être demandés) ;
- un **nom de domaine**, chez n'importe quel registraire, dont tu peux modifier les enregistrements DNS. Choisis le sous-domaine de l'application, par exemple `app.ton-domaine.sn` ;
- **ton ordinateur** (macOS), avec un terminal, et ce dépôt à jour ;
- **un gestionnaire de mots de passe** : il gardera la clé privée des sauvegardes et une copie des secrets du serveur.

Et, sur ton ordinateur, la preuve que la version à déployer tient la route (quelques minutes, Docker doit tourner) :

```bash
cd ~/angular/yaar
npm ci && npm test                 # tous les tests
infra/production.test.sh           # HTTPS, en-têtes, secrets : la production telle qu'elle sera
```

Tout doit être vert. Sinon, on ne déploie pas.

## 1. La clé SSH (sur ton ordinateur, une seule fois)

C'est elle qui t'ouvrira le serveur : jamais de mot de passe.

```bash
ls ~/.ssh/id_ed25519.pub || ssh-keygen -t ed25519 -C "yaar-fondateur"   # accepte l'emplacement proposé, choisis une phrase de passe
cat ~/.ssh/id_ed25519.pub          # la clé publique, à coller dans Hetzner à l'étape suivante
```

## 2. Le serveur (dans la console Hetzner)

1. **Créer un projet** : « Yaar ».
2. **Security → SSH keys → Add SSH key** : colle la clé publique de l'étape 1.
3. **Firewalls → Create Firewall**, nommé « yaar » ; règles **entrantes** :
   - TCP **22** (SSH) ;
   - TCP **80** (Let's Encrypt vérifie le domaine par lui ; Caddy y renvoie vers le HTTPS) ;
   - TCP **443** (l'application).

   Rien d'autre : la base et l'API ne sont jamais ouvertes sur Internet.
4. **Servers → Add Server** :
   - **Location** : Falkenstein ou Nuremberg (Allemagne) — Helsinki convient aussi. Note-la : la Storage Box des sauvegardes, plus tard, ira dans un **autre** centre ;
   - **Image** : **Ubuntu 24.04** ;
   - **Type** : processeur partagé, **2 vCPU, 4 Go de mémoire, 40 Go de disque** au moins (la gamme « CX » ou « CPX » ; vérifie le nom et le prix du moment dans la console) — de quoi construire les images sur place ;
   - **Networking** : IPv4 publique **et** IPv6 ;
   - **SSH keys** : coche ta clé ;
   - **Firewalls** : coche « yaar » ;
   - **Backups** : facultatif (≈ 20 % du prix du serveur). Nos sauvegardes chiffrées suffisent ; c'est un filet de plus, en un clic de restauration ;
   - **Name** : `yaar-prod`.
5. Note l'**adresse IPv4** du serveur.

## 3. Le domaine (chez ton registraire)

Un enregistrement **A** : `app` (ou le sous-domaine choisi) → l'IPv4 du serveur. Durée de vie (TTL) courte si on te la demande (300 s).

Vérifie depuis ton ordinateur, quelques minutes plus tard :

```bash
dig +short app.ton-domaine.sn      # doit répondre l'IPv4 du serveur
```

Tant qu'il ne répond pas, n'allume pas la pile : Let's Encrypt refuserait le certificat, et ses refus répétés bloquent le domaine une heure.

## 4. Préparer le serveur (une fois, en root)

```bash
ssh root@IP_DU_SERVEUR
```

Puis, sur le serveur :

```bash
apt-get update && apt-get -y upgrade && apt-get -y install git unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades   # correctifs de sécurité du système, seuls, chaque nuit
curl -fsSL https://get.docker.com | sh                   # Docker et son compose, de la source officielle
adduser --disabled-password --gecos "" yaar && usermod -aG docker yaar
mkdir -p /home/yaar/.ssh && cp ~/.ssh/authorized_keys /home/yaar/.ssh/ && chown -R yaar:yaar /home/yaar/.ssh && chmod 700 /home/yaar/.ssh
mkdir -p /srv/sauvegardes && chown yaar:yaar /srv/sauvegardes && chmod 700 /srv/sauvegardes
timedatectl set-timezone UTC                              # l'heure de Dakar
# SSH par clé seulement, et plus de connexion directe en root
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/; s/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart ssh
exit
```

**Avant de fermer** cette session, ouvre-en une seconde pour vérifier que `ssh yaar@IP_DU_SERVEUR` marche : si la clé n'était pas recopiée, tu te serais enfermé dehors (la console Hetzner, « Console » du serveur, reste alors une porte de secours).

## 5. Le code (en yaar)

Le dépôt est privé : le serveur le lit avec une **clé de déploiement en lecture seule**, propre à lui.

```bash
ssh yaar@IP_DU_SERVEUR
ssh-keygen -t ed25519 -C "yaar-prod" -N "" -f ~/.ssh/id_ed25519
cat ~/.ssh/id_ed25519.pub
```

Sur GitHub : **dépôt → Settings → Deploy keys → Add deploy key**, colle la clé, **sans** cocher « Allow write access ». Puis :

```bash
git clone git@github.com:Bass22/yaar.git ~/yaar && cd ~/yaar
```

## 6. Les secrets

```bash
cp infra/.env.example infra/.env && chmod 600 infra/.env
for name in DB_PASSWORD APP_DB_PASSWORD JWT_SECRET; do sed -i "s|^$name=.*|$name=$(openssl rand -hex 32)|" infra/.env; done
sed -i 's|^# SITE_ADDRESS=.*|SITE_ADDRESS=app.ton-domaine.sn|' infra/.env
grep -c '=..*' infra/.env          # les lignes remplies ; ouvre le fichier si un doute : nano infra/.env
```

Copie le contenu de `infra/.env` dans ton gestionnaire de mots de passe (une note sécurisée « Yaar — serveur ») : sans lui, une restauration sur un nouveau serveur oblige à en créer d'autres, et tout le monde se reconnecte. Ce fichier ne va **jamais** dans le dépôt, ni dans un e-mail.

## 7. Allumer

```bash
cd ~/yaar
export COMPOSE_FILE=infra/docker-compose.yml:infra/docker-compose.prod.yml
echo 'export COMPOSE_FILE=infra/docker-compose.yml:infra/docker-compose.prod.yml' >> ~/.bashrc
docker compose up -d --build --wait            # 5 à 15 minutes la première fois : les images se construisent
docker compose ps                              # tout « running » ou « healthy »
```

Ouvre `https://app.ton-domaine.sn` : le cadenas est là, l'écran du numéro s'affiche.

## 8. L'élevage et son premier admin

Le PIN de l'admin (6 chiffres) est demandé au clavier, jamais écrit dans la commande :

```bash
docker compose run --rm -it migrate node dist/bootstrap-tenant.js \
  --tenant "Nom de l'élevage" --site "Poulailler Nord" --time-zone Africa/Dakar \
  --admin-name "Ton nom" --admin-phone +221XXXXXXXXX
```

Note le `tenant_id` affiché (il sert à ajouter un autre admin plus tard, voir `CLAUDE.md` §9). Connecte-toi sur `https://app.ton-domaine.sn` avec ton numéro et ce PIN, puis, au bureau, ajoute tes gardiens à leur site : ils recevront un PIN provisoire.

## 9. Les sauvegardes

**Sur ton ordinateur**, une seule fois, la paire de clés (la privée ne va **jamais** sur le serveur) :

```bash
cd ~/angular/yaar
docker build -q -t yaar-age -f infra/docker/age.Dockerfile infra/docker
docker run --rm --entrypoint age-keygen yaar-age > ~/yaar-cle-privee.txt
grep 'public key' ~/yaar-cle-privee.txt        # « age1… » : la clé publique
```

Range `~/yaar-cle-privee.txt` dans le gestionnaire de mots de passe **et** sur une clé USB rangée, puis efface-le de l'ordinateur.

**Sur le serveur**, en `yaar`, la sauvegarde de la nuit (remplace `age1…` par ta clé publique) :

```bash
crontab -e
# ajoute cette ligne :
0 2 * * * cd ~/yaar && COMPOSE_FILE=infra/docker-compose.yml:infra/docker-compose.prod.yml BACKUP_RECIPIENT=age1… BACKUP_DIR=/srv/sauvegardes infra/backup/backup.sh >> /srv/sauvegardes/journal.log 2>&1
```

Lance-la une fois tout de suite, pour voir qu'elle marche :

```bash
cd ~/yaar && BACKUP_RECIPIENT=age1… BACKUP_DIR=/srv/sauvegardes infra/backup/backup.sh && ls -l /srv/sauvegardes
```

**Sur ton ordinateur**, la copie de chaque matin (le serveur ne peut pas atteindre ton ordinateur ; c'est l'ordinateur qui vient chercher) :

```bash
mkdir -p ~/Sauvegardes-Yaar
crontab -e
# ajoute :
30 8 * * * rsync -a --ignore-existing yaar@IP_DU_SERVEUR:/srv/sauvegardes/ ~/Sauvegardes-Yaar/
```

## 10. Vérifier, avant d'annoncer l'application

- [ ] `https://app.ton-domaine.sn` s'ouvre avec le cadenas ; `http://` renvoie vers `https://`.
- [ ] Tu te connectes au bureau ; un gardien se connecte sur son téléphone avec son PIN provisoire, choisit le sien, et voit son cahier.
- [ ] Le gardien déclare un mort **en mode avion**, puis rallume le réseau : la déclaration arrive au bureau, une seule fois.
- [ ] Une sauvegarde existe dans `/srv/sauvegardes`, et le lendemain sur ton ordinateur.
- [ ] Une fois, à blanc : **restaurer** une sauvegarde sur un second petit serveur jetable (`docs/deploiement.md`, « Restaurer »), puis le supprimer. Une sauvegarde jamais restaurée n'est qu'une promesse.

## Ensuite

| Quand | Quoi | Où |
|---|---|---|
| À chaque nouvelle version | sauvegarde, `git pull`, `docker compose up -d --build --wait` | `docs/deploiement.md` §4 |
| Une fois par mois | regarder `df -h` (le disque) et `/srv/sauvegardes/journal.log` ; monter les images de base | `docs/deploiement.md` |
| Une fois par an, ou au moindre soupçon | changer les secrets de la pile | `infra/rotate-secret.sh`, `docs/deploiement.md` §5 |
| Quand le pilote s'élargit | copie automatique des sauvegardes (Storage Box Hetzner dans un autre centre, ou OVH) | `docs/deploiement.md` |

**Si quelque chose ne va pas** : `docker compose logs --tail 100 web` (Caddy, le certificat), `docker compose logs --tail 100 api` (l'application), `docker compose ps` (qui est tombé). Un certificat refusé vient presque toujours du domaine qui ne pointe pas encore vers le serveur, ou du port 80 fermé dans le pare-feu.
