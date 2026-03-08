# Avatars GLB

Le jeu tente de charger les fichiers suivants s'ils existent :

- `player.glb`
- `nova.glb`
- `pixel.glb`
- `goldie.glb`

S'ils sont absents, `main.js` bascule automatiquement sur des avatars stylisés procéduraux
dans la scène Three.js, puis sur des avatars DOM si Three.js n'est pas disponible.
