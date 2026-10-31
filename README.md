# Anime Sama Bot

Bot Telegram pour rechercher, parcourir et ouvrir des épisodes d’anime via le site Anime-sama, ainsi qu’une Mini App web pour lire les sources avec plein écran et télécharger la vidéo.

## Fonctionnalités

- Recherche d’anime depuis Telegram
- Sélection d’une saison et d’un épisode
- Choix de langue (VOSTFR / VF)
- Ouverture d’une Mini App web
- Lecture de la source vidéo dans un lecteur intégré
- Copie du lien de la source
- Téléchargement de la vidéo via `yt-dlp`
- Affichage des détails AniList

## Structure du projet

- `bot.js` : point d’entrée du bot Telegram et du serveur Express
- `public/index.html` : Mini App web
- `public/style.css` : styles de la Mini App
- `public/app.js` : utilitaire de téléchargement côté serveur
- `downloads/` : dossier de sortie des vidéos téléchargées

## Prérequis

- Node.js 18+
- npm
- un bot Telegram créé via BotFather
- accès internet
- `yt-dlp` installé sur le serveur

### Installation de `yt-dlp`

Ubuntu / Debian :

```bash
sudo apt update
sudo apt install yt-dlp
```

ou

```bash
python3 -m pip install yt-dlp
```

MacOS :

```bash
brew install yt-dlp
```

## Installation

```bash
npm install
```

## Configuration serveur

Créer un fichier `.env` à la racine du projet en copiant l’exemple :

```bash
cp .env.example .env
```

Exemple de configuration :

```env
BOT_TOKEN=123456:ABCDEF
PORT=3000
SERVER_URL=https://votre-domaine.com
BASE_URL=https://anime-sama.to
```

### Variables

- `BOT_TOKEN` : token du bot Telegram
- `PORT` : port d’écoute du serveur Express
- `SERVER_URL` : URL publique du serveur pour la Mini App Telegram
- `BASE_URL` : URL du site source Anime-sama

> `SERVER_URL` doit être publique et accessible depuis Telegram pour que la Mini App fonctionne correctement.

## Lancement

Mode développement / production :

```bash
node bot.js
```

Ou via npm :

```bash
npm start
```

Le bot se connecte à Telegram et démarre le serveur web sur le port défini.

## Utilisation

1. Démarrer le bot
2. Envoyer `/search` suivi du nom d’un anime
3. Sélectionner l’anime puis la saison
4. Choisir un épisode
5. Ouvrir la Mini App depuis le bouton Telegram
6. Lire la source ou lancer un téléchargement

## Mini App

La Mini App est servie statiquement par Express depuis le dossier `public/`.

Les fichiers de la Mini App sont accessibles à l’URL :

```text
http://localhost:3000/index.html
```

ou via l’URL publique configurée dans `SERVER_URL`.

## Téléchargement

Le téléchargement est déclenché côté serveur via la route :

```text
POST /api/download
```

Le fichier est enregistré dans le dossier `downloads/` et peut ensuite être servi publiquement via :

```text
/downloads/nom-fichier.mp4
```

## Dépannage

### Le bot ne démarre pas

Vérifier :

- le token Telegram est bien présent dans `.env`
- le port n’est pas déjà utilisé
- le domaine `SERVER_URL` est correctement configuré

### La Mini App ne s’ouvre pas

Vérifier :

- `SERVER_URL` est bien publique
- le bot est bien lancé
- la variable `BOT_TOKEN` est valide

### Le téléchargement ne fonctionne pas

Vérifier :

- `yt-dlp` est installé
- le site Anime-sama est accessible
- le lien de la source est valide

## Licence

Projet personnel / usage interne.
