# Skygrô Royale

Jeu de cartes web Skyjo-like en HTML, CSS et JavaScript vanilla.

## Déploiement

Aucun backend, aucun Python, aucun framework n'est requis pour la version en ligne.
Le projet est un site statique.

Tu peux le publier tel quel sur :

- GitHub Pages
- Netlify
- Vercel
- Cloudflare Pages

## Fichiers à envoyer

- `index.html`
- `style.css`
- `main.js`
- `manifest.webmanifest`
- dossier `assets/`

## Démarrage rapide

### GitHub Pages

1. Pousse le dépôt sur GitHub.
2. Va dans `Settings > Pages`.
3. Choisis la branche `main` et le dossier racine.
4. Le site sera accessible via une URL publique.

### Netlify / Vercel

1. Importe le dépôt.
2. Configure un projet statique sans build command.
3. Définis le dossier de publication sur la racine du projet.

## Notes

- Le layout est responsive desktop + mobile paysage.
- La scène 3D essaie de charger Three.js via CDN quand le site est en ligne.
- Si le CDN ou les GLB sont absents, le jeu bascule automatiquement sur les avatars fallback.
