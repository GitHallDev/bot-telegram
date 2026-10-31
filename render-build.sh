#!/usr/bin/env bash
# Arrêter le script en cas d'erreur
set -o errexit

echo "📦 Installation des dépendances Node.js..."
npm install

echo "📥 Téléchargement de yt-dlp..."
# Télécharge la dernière version officielle de yt-dlp pour Linux
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o yt-dlp

# Le rendre exécutable
chmod a+rx yt-dlp

echo "✅ yt-dlp a été installé avec succès localement !"