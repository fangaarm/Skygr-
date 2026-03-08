"use strict";

(function () {
  const CONFIG = {
    storageKey: "skygro-arcade-settings",
    tutorialKey: "skygro-arcade-tutorial-seen",
    aiCount: 3,
    difficulty: 2,
    funMode: true,
    soundEnabled: true,
    historyLimit: 6,
    players: [
      { name: "Vous", human: true, seat: "bottom", color: "#49d8ff" },
      { name: "Nova", human: false, seat: "top", color: "#9a78ff" },
      { name: "Pixel", human: false, seat: "left", color: "#ff6cb3" },
      { name: "Goldie", human: false, seat: "right", color: "#ffd977" },
    ],
    cardCounts: {
      "-2": 5,
      "-1": 10,
      "0": 15,
      "1": 10,
      "2": 10,
      "3": 10,
      "4": 10,
      "5": 10,
      "6": 10,
      "7": 10,
      "8": 10,
      "9": 10,
      "10": 10,
      "11": 10,
      "12": 10,
    },
    modelPaths: [
      "./assets/models/player.glb",
      "./assets/models/nova.glb",
      "./assets/models/pixel.glb",
      "./assets/models/goldie.glb",
    ],
    threeScripts: [
      "https://cdn.jsdelivr.net/npm/three@0.152.2/build/three.min.js",
      "https://cdn.jsdelivr.net/npm/three@0.152.2/examples/js/loaders/GLTFLoader.js",
    ],
    tutorialSteps: [
      "Clique sur deux cartes de ton tableau pour lancer la manche.",
      "À ton tour, prends la défausse si elle t’aide, sinon pioche.",
      "Après une pioche, remplace une carte ou défausse et retourne une carte cachée.",
      "Quand une colonne de 3 cartes visibles a la même valeur, elle disparaît.",
    ],
  };

  const APP = {
    engine: null,
    audio: null,
    avatars: null,
    tutorialStep: 0,
    aiLock: false,
    roundToken: 0,
    elements: {},
  };

  const CARD_COLUMNS = 4;
  const CARD_ROWS = 3;
  const PLAYER_COUNT = 4;
  const AI_DELAY = 680;
  const DEAL_DURATION = 1320;

  // Web Audio SFX keep the prototype self-contained when no audio assets are provided.
  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.muted = false;
    }

    setMuted(value) {
      this.muted = Boolean(value);
    }

    unlock() {
      if (this.ctx) {
        return;
      }
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        return;
      }
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.14;
      this.master.connect(this.ctx.destination);
    }

    play(kind) {
      if (this.muted) {
        return;
      }
      this.unlock();
      if (!this.ctx || !this.master) {
        return;
      }
      const now = this.ctx.currentTime;
      const note = (frequency, duration, type, gainValue, offset = 0) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(frequency, now + offset);
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(gainValue, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration);
        osc.connect(gain);
        gain.connect(this.master);
        osc.start(now + offset);
        osc.stop(now + offset + duration + 0.05);
      };

      if (kind === "draw") {
        note(410, 0.18, "triangle", 0.08);
        note(620, 0.14, "sine", 0.05, 0.06);
      } else if (kind === "flip") {
        note(280, 0.1, "square", 0.05);
        note(180, 0.08, "triangle", 0.04, 0.04);
      } else if (kind === "swap") {
        note(320, 0.14, "triangle", 0.06);
        note(500, 0.18, "triangle", 0.05, 0.04);
      } else if (kind === "score") {
        note(440, 0.12, "sine", 0.05);
        note(660, 0.16, "sine", 0.05, 0.08);
        note(880, 0.18, "triangle", 0.05, 0.16);
      } else if (kind === "good") {
        note(520, 0.1, "sine", 0.05);
        note(780, 0.12, "triangle", 0.05, 0.07);
      } else if (kind === "bad") {
        note(180, 0.18, "sawtooth", 0.04);
        note(130, 0.14, "triangle", 0.04, 0.05);
      }
    }
  }

  // GameEngine owns the Skyjo-like rules, round state, deck flow, and scoring.
  class GameEngine {
    constructor(config) {
      this.config = config;
      this.resetMatch();
    }

    resetMatch() {
      this.match = {
        roundNumber: 0,
        players: this.config.players.map((player, index) => ({
          id: index,
          name: player.name,
          human: player.human,
          seat: player.seat,
          color: player.color,
          totalScore: 0,
          roundScore: 0,
          cards: [],
        })),
      };
      this.round = null;
    }

    createDeck() {
      const deck = [];
      let id = 0;
      Object.entries(this.config.cardCounts).forEach(([value, count]) => {
        for (let index = 0; index < count; index += 1) {
          deck.push({
            id: `card-${id}`,
            value: Number(value),
            faceUp: false,
            cleared: false,
          });
          id += 1;
        }
      });
      return shuffle(deck);
    }

    startRound() {
      this.match.roundNumber += 1;
      const deck = this.createDeck();
      const players = this.match.players.map((player) => ({
        ...player,
        roundScore: 0,
        cards: [],
      }));

      for (let row = 0; row < CARD_ROWS; row += 1) {
        for (let col = 0; col < CARD_COLUMNS; col += 1) {
          players.forEach((player) => {
            const dealt = deck.pop();
            player.cards.push({
              ...dealt,
              faceUp: false,
              cleared: false,
            });
          });
        }
      }

      const discardPile = [markFaceUp(deck.pop())];

      this.round = {
        deck,
        discardPile,
        players,
        phase: "dealing",
        turnIndex: 0,
        finalCaller: null,
        finalTurnsRemaining: null,
        statusText: "Distribution en cours...",
        history: [],
        drawnCard: null,
        drawnSource: null,
        initialRevealsRemaining: 2,
        winnerText: "",
      };

      players
        .filter((player) => !player.human)
        .forEach((player) => {
          const revealIndices = AIStrategy.chooseInitialRevealIndices(player);
          revealIndices.forEach((cardIndex) => {
            player.cards[cardIndex].faceUp = true;
          });
          this.resolvePlayerColumns(player);
        });

      this.addHistory("Les cartes arrivent sur la table.");
      return this.round;
    }

    finishDeal() {
      if (!this.round) {
        return;
      }
      this.round.phase = "initial-reveal";
      this.round.statusText = "Retourne 2 cartes de ton tableau pour lancer la manche.";
    }

    getCurrentPlayer() {
      return this.round.players[this.round.turnIndex];
    }

    getHumanPlayer() {
      return this.round.players[0];
    }

    getTopDiscard() {
      return this.round.discardPile[this.round.discardPile.length - 1] || null;
    }

    getVisibleScore(player) {
      return player.cards.reduce((total, card) => {
        if (card.cleared) {
          return total;
        }
        return card.faceUp ? total + card.value : total;
      }, 0);
    }

    getHiddenCount(player) {
      return player.cards.filter((card) => !card.faceUp && !card.cleared).length;
    }

    isBoardOpen(player) {
      return player.cards.every((card) => card.faceUp || card.cleared);
    }

    addHistory(entry) {
      this.round.history.unshift(entry);
      this.round.history = this.round.history.slice(0, this.config.historyLimit);
    }

    revealInitialCard(cardIndex) {
      if (this.round.phase !== "initial-reveal") {
        return { ok: false };
      }
      const player = this.getHumanPlayer();
      const card = player.cards[cardIndex];
      if (!card || card.faceUp || card.cleared) {
        return { ok: false };
      }
      card.faceUp = true;
      this.round.initialRevealsRemaining -= 1;
      this.resolvePlayerColumns(player);
      this.addHistory(`Vous révélez ${formatCardValue(card.value)}.`);
      const result = { ok: true, value: card.value, cardIndex };
      if (this.round.initialRevealsRemaining <= 0) {
        this.beginTurns();
      } else {
        this.round.statusText = `Encore ${this.round.initialRevealsRemaining} carte à retourner.`;
      }
      return result;
    }

    beginTurns() {
      const revealedSums = this.round.players.map((player) =>
        player.cards.reduce((total, card) => {
          return card.faceUp && !card.cleared ? total + card.value : total;
        }, 0)
      );
      let starter = 0;
      let bestScore = revealedSums[0];
      revealedSums.forEach((score, index) => {
        if (score < bestScore) {
          bestScore = score;
          starter = index;
        }
      });
      this.round.turnIndex = starter;
      this.round.phase = "await-draw";
      this.round.statusText = `${this.round.players[starter].name} commence la manche.`;
      this.addHistory(`${this.round.players[starter].name} prend la main.`);
    }

    drawFromDeck() {
      if (this.round.phase !== "await-draw") {
        return { ok: false };
      }
      this.reshuffleIfNeeded();
      const card = this.round.deck.pop();
      if (!card) {
        return { ok: false };
      }
      this.round.drawnCard = markFaceUp(card);
      this.round.drawnSource = "deck";
      this.round.phase = "await-replace-or-discard";
      this.round.statusText =
        "Choisis une carte à remplacer, ou défausse celle-ci puis retourne une carte cachée.";
      return { ok: true, card: this.round.drawnCard };
    }

    takeDiscard() {
      if (this.round.phase !== "await-draw") {
        return { ok: false };
      }
      const card = this.round.discardPile.pop();
      if (!card) {
        return { ok: false };
      }
      this.round.drawnCard = markFaceUp(card);
      this.round.drawnSource = "discard";
      this.round.phase = "await-replace-or-discard";
      this.round.statusText = "Remplace une carte de ton tableau avec la défausse.";
      return { ok: true, card: this.round.drawnCard };
    }

    replaceCurrentPlayerCard(cardIndex) {
      if (this.round.phase !== "await-replace-or-discard" || !this.round.drawnCard) {
        return { ok: false };
      }
      const player = this.getCurrentPlayer();
      const target = player.cards[cardIndex];
      if (!target || target.cleared) {
        return { ok: false };
      }
      const replaced = { ...target, faceUp: true, cleared: false };
      player.cards[cardIndex] = {
        ...this.round.drawnCard,
        faceUp: true,
        cleared: false,
      };
      this.round.discardPile.push(replaced);
      this.round.drawnCard = null;
      this.round.drawnSource = null;
      const clears = this.resolvePlayerColumns(player);
      const completion = this.completeTurn(player, player.cards[cardIndex].value, clears);
      return {
        ok: true,
        type: "replace",
        cardIndex,
        newValue: player.cards[cardIndex].value,
        oldValue: replaced.value,
        clears,
        ...completion,
      };
    }

    discardDrawnCard() {
      if (
        this.round.phase !== "await-replace-or-discard" ||
        !this.round.drawnCard ||
        this.round.drawnSource !== "deck"
      ) {
        return { ok: false };
      }
      this.round.discardPile.push(this.round.drawnCard);
      const rejectedValue = this.round.drawnCard.value;
      this.round.drawnCard = null;
      this.round.drawnSource = null;
      const player = this.getCurrentPlayer();
      this.addHistory(`${player.name} rejette ${formatCardValue(rejectedValue)}.`);
      if (this.getHiddenCount(player) > 0) {
        this.round.phase = "await-reveal-after-discard";
        this.round.statusText = "Carte rejetée. Retourne une carte cachée.";
      } else {
        this.endTurnSequence(player);
      }
      return { ok: true, rejectedValue };
    }

    revealCurrentPlayerCard(cardIndex) {
      if (
        this.round.phase !== "await-reveal-after-discard" &&
        this.round.phase !== "initial-reveal"
      ) {
        return { ok: false };
      }
      if (this.round.phase === "initial-reveal") {
        return this.revealInitialCard(cardIndex);
      }
      const player = this.getCurrentPlayer();
      const target = player.cards[cardIndex];
      if (!target || target.faceUp || target.cleared) {
        return { ok: false };
      }
      target.faceUp = true;
      const clears = this.resolvePlayerColumns(player);
      const completion = this.completeTurn(player, target.value, clears);
      return {
        ok: true,
        type: "reveal",
        cardIndex,
        value: target.value,
        clears,
        ...completion,
      };
    }

    completeTurn(player, shownValue, clears) {
      this.addHistory(
        `${player.name} joue ${formatCardValue(shownValue)}${clears.length ? " et efface une colonne." : "."}`
      );
      return this.endTurnSequence(player);
    }

    endTurnSequence(player) {
      if (this.round.finalCaller === null && this.isBoardOpen(player)) {
        this.round.finalCaller = player.id;
        this.round.finalTurnsRemaining = PLAYER_COUNT - 1;
        this.addHistory(`${player.name} déclenche la fin de manche.`);
      } else if (this.round.finalCaller !== null && player.id !== this.round.finalCaller) {
        this.round.finalTurnsRemaining -= 1;
      }

      if (this.round.finalCaller !== null && this.round.finalTurnsRemaining <= 0) {
        return this.finishRound();
      }

      this.round.turnIndex = (this.round.turnIndex + 1) % PLAYER_COUNT;
      this.round.phase = "await-draw";
      this.round.statusText = `Tour de ${this.getCurrentPlayer().name}.`;
      return { roundEnded: false };
    }

    finishRound() {
      this.round.players.forEach((player) => {
        player.cards.forEach((card) => {
          if (!card.cleared) {
            card.faceUp = true;
          }
        });
        this.resolvePlayerColumns(player);
        player.roundScore = player.cards.reduce((total, card) => {
          if (card.cleared) {
            return total;
          }
          return total + card.value;
        }, 0);
      });

      const callerId = this.round.finalCaller;
      if (callerId !== null) {
        const caller = this.round.players[callerId];
        const minimum = Math.min(...this.round.players.map((player) => player.roundScore));
        if (caller.roundScore > minimum) {
          caller.roundScore *= 2;
          this.addHistory(`${caller.name} ne gagne pas la manche: score doublé.`);
        }
      }

      this.round.players.forEach((player, index) => {
        this.match.players[index].totalScore += player.roundScore;
      });

      const ranking = [...this.round.players]
        .map((player, index) => ({
          ...player,
          totalScore: this.match.players[index].totalScore,
        }))
        .sort((a, b) => a.roundScore - b.roundScore);

      this.round.phase = "round-end";
      this.round.statusText = "Manche terminée.";
      this.round.winnerText = `${ranking[0].name} prend la manche avec ${ranking[0].roundScore} points.`;
      return { roundEnded: true, ranking };
    }

    resolvePlayerColumns(player) {
      const clears = [];
      for (let column = 0; column < CARD_COLUMNS; column += 1) {
        const indices = [column, column + CARD_COLUMNS, column + CARD_COLUMNS * 2];
        const columnCards = indices.map((index) => player.cards[index]);
        const canClear =
          columnCards.every((card) => card && card.faceUp && !card.cleared) &&
          columnCards.every((card) => card.value === columnCards[0].value);
        if (canClear) {
          indices.forEach((index) => {
            player.cards[index].cleared = true;
          });
          clears.push({ column, value: columnCards[0].value });
        }
      }
      return clears;
    }

    reshuffleIfNeeded() {
      if (this.round.deck.length > 0) {
        return;
      }
      const topDiscard = this.round.discardPile.pop();
      this.round.deck = shuffle(
        this.round.discardPile.map((card) => ({
          ...card,
          faceUp: false,
          cleared: false,
        }))
      );
      this.round.discardPile = topDiscard ? [markFaceUp(topDiscard)] : [];
      this.addHistory("La pioche est reconstituée depuis la défausse.");
    }
  }

  // AvatarStage uses GLB models when available and falls back to procedural or DOM avatars.
  class AvatarStage {
    constructor(container, fallbackContainer, emotionLayer) {
      this.container = container;
      this.fallbackContainer = fallbackContainer;
      this.emotionLayer = emotionLayer;
      this.renderer = null;
      this.scene = null;
      this.camera = null;
      this.clock = null;
      this.avatars = [];
      this.usingThree = false;
      this.frameHandle = null;
    }

    async init() {
      await ensureThreeAvailable();
      if (!window.THREE) {
        this.buildDomFallback();
        return;
      }
      try {
        this.usingThree = true;
        this.clock = new window.THREE.Clock();
        this.scene = new window.THREE.Scene();
        this.scene.fog = new window.THREE.Fog(0x050913, 8, 22);
        this.camera = new window.THREE.PerspectiveCamera(38, 1, 0.1, 100);
        this.camera.position.set(0, 6.8, 11.8);
        this.renderer = new window.THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.shadowMap.enabled = true;
        this.container.appendChild(this.renderer.domElement);

        const ambient = new window.THREE.HemisphereLight(0xffffff, 0x092243, 1.05);
        this.scene.add(ambient);

        const key = new window.THREE.DirectionalLight(0xeffdff, 1.3);
        key.position.set(2.4, 8.5, 4.5);
        key.castShadow = true;
        this.scene.add(key);

        const fill = new window.THREE.PointLight(0xff79b5, 1.4, 12);
        fill.position.set(-4, 4, 2);
        this.scene.add(fill);

        const table = new window.THREE.Mesh(
          new window.THREE.CylinderGeometry(5.4, 5.8, 0.5, 52),
          new window.THREE.MeshStandardMaterial({
            color: 0x153260,
            emissive: 0x0b2442,
            roughness: 0.65,
            metalness: 0.35,
          })
        );
        table.receiveShadow = true;
        table.position.y = -0.6;
        this.scene.add(table);

        const ring = new window.THREE.Mesh(
          new window.THREE.TorusGeometry(4.8, 0.08, 12, 64),
          new window.THREE.MeshBasicMaterial({ color: 0x2ad6ff, transparent: true, opacity: 0.55 })
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = -0.3;
        this.scene.add(ring);

        const avatarPromises = CONFIG.players.map((player, index) =>
          this.createAvatar(player, index)
        );
        const avatarGroups = await Promise.all(avatarPromises);
        avatarGroups.forEach((group) => this.scene.add(group));

        this.resize();
        this.animate();
      } catch (error) {
        console.warn("Fallback avatar DOM activé:", error);
        if (this.renderer?.domElement) {
          this.renderer.domElement.remove();
        }
        this.usingThree = false;
        this.buildDomFallback();
      }
    }

    async createAvatar(player, index) {
      const seatPositions = [
        { x: 0, y: 0.6, z: 4.2 },
        { x: 0, y: 0.9, z: -4.1 },
        { x: -4.3, y: 0.8, z: 0.2, rotation: Math.PI / 2.1 },
        { x: 4.3, y: 0.8, z: 0.2, rotation: -Math.PI / 2.1 },
      ];
      const position = seatPositions[index];
      const loader = window.THREE.GLTFLoader ? new window.THREE.GLTFLoader() : null;
      let group = null;
      if (loader) {
        try {
          group = await new Promise((resolve, reject) => {
            loader.load(
              CONFIG.modelPaths[index],
              (gltf) => resolve(gltf.scene),
              undefined,
              reject
            );
          });
          group.scale.setScalar(1.2);
        } catch (error) {
          group = null;
        }
      }

      if (!group) {
        group = this.createProceduralAvatar(player.color);
      }

      group.position.set(position.x, position.y, position.z);
      group.rotation.y = position.rotation || Math.PI;
      group.userData = {
        baseY: position.y,
        mood: "idle",
        index,
        glow: null,
        reactionTimer: 0,
      };

      const glow = new window.THREE.Mesh(
        new window.THREE.RingGeometry(0.55, 0.88, 32),
        new window.THREE.MeshBasicMaterial({
          color: new window.THREE.Color(player.color),
          transparent: true,
          opacity: 0.38,
          side: window.THREE.DoubleSide,
        })
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = -0.62;
      group.add(glow);
      group.userData.glow = glow;
      this.avatars[index] = group;
      return group;
    }

    createProceduralAvatar(colorHex) {
      const group = new window.THREE.Group();
      const color = new window.THREE.Color(colorHex);
      const body = new window.THREE.Mesh(
        new window.THREE.CapsuleGeometry(0.48, 0.9, 8, 16),
        new window.THREE.MeshStandardMaterial({
          color,
          metalness: 0.22,
          roughness: 0.48,
        })
      );
      body.castShadow = true;
      group.add(body);

      const head = new window.THREE.Mesh(
        new window.THREE.SphereGeometry(0.44, 20, 20),
        new window.THREE.MeshStandardMaterial({
          color: 0xffd4be,
          roughness: 0.7,
        })
      );
      head.position.y = 0.9;
      head.castShadow = true;
      group.add(head);

      const visor = new window.THREE.Mesh(
        new window.THREE.TorusGeometry(0.34, 0.09, 12, 32, Math.PI),
        new window.THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: color.clone().multiplyScalar(0.24),
          roughness: 0.4,
          metalness: 0.62,
        })
      );
      visor.position.set(0, 0.96, 0.32);
      visor.rotation.x = Math.PI / 1.2;
      group.add(visor);

      const hat = new window.THREE.Mesh(
        new window.THREE.ConeGeometry(0.28, 0.46, 18),
        new window.THREE.MeshStandardMaterial({
          color: color.clone().offsetHSL(0.02, 0, 0.1),
          roughness: 0.48,
          metalness: 0.24,
        })
      );
      hat.position.set(0.18, 1.42, 0);
      hat.rotation.z = Math.PI / 9;
      group.add(hat);

      return group;
    }

    buildDomFallback() {
      this.fallbackContainer.classList.remove("is-hidden");
      this.fallbackContainer.innerHTML = "";
      const positions = [
        { left: "50%", top: "78%" },
        { left: "50%", top: "16%" },
        { left: "14%", top: "50%" },
        { left: "86%", top: "50%" },
      ];

      CONFIG.players.forEach((player, index) => {
        const avatar = document.createElement("div");
        avatar.className = "avatar-node";
        avatar.style.left = positions[index].left;
        avatar.style.top = positions[index].top;
        avatar.style.setProperty("--avatar-color", `linear-gradient(180deg, ${player.color}, #2439ff)`);
        avatar.dataset.index = String(index);

        const label = document.createElement("div");
        label.className = "seat-tag";
        label.textContent = player.name;
        label.style.left = positions[index].left;
        label.style.top = `calc(${positions[index].top} + 54px)`;

        this.fallbackContainer.appendChild(avatar);
        this.fallbackContainer.appendChild(label);
        this.avatars[index] = avatar;
      });
    }

    setActive(index) {
      if (this.usingThree) {
        this.avatars.forEach((avatar, avatarIndex) => {
          if (!avatar) {
            return;
          }
          avatar.userData.glow.material.opacity = avatarIndex === index ? 0.82 : 0.28;
          avatar.scale.setScalar(avatarIndex === index ? 1.08 : 1);
        });
      } else {
        this.avatars.forEach((avatar, avatarIndex) => {
          avatar.classList.toggle("active-avatar", avatarIndex === index);
        });
      }
    }

    react(index, mood, bubble) {
      if (this.usingThree) {
        const avatar = this.avatars[index];
        if (avatar) {
          avatar.userData.mood = mood;
          avatar.userData.reactionTimer = 0.9;
          avatar.userData.glow.material.color.set(
            mood === "good" ? 0x39ffca : mood === "bad" ? 0xff8249 : 0x2ad6ff
          );
        }
      }
      this.showBubble(index, bubble);
    }

    showBubble(index, bubble) {
      const positions = [
        { left: "50%", top: "72%" },
        { left: "50%", top: "14%" },
        { left: "17%", top: "42%" },
        { left: "83%", top: "42%" },
      ];
      const node = document.createElement("div");
      node.className = "emotion-bubble";
      node.style.left = positions[index].left;
      node.style.top = positions[index].top;
      node.textContent = bubble;
      this.emotionLayer.appendChild(node);
      setTimeout(() => node.remove(), 1200);
    }

    introSweep() {
      if (!this.usingThree || !this.camera) {
        return;
      }
      this.camera.position.set(-1.4, 7.2, 12.4);
      this.camera.lookAt(0, 0.5, 0);
      const start = performance.now();
      const animateIntro = (time) => {
        const progress = Math.min((time - start) / 1400, 1);
        const eased = easeOutCubic(progress);
        this.camera.position.x = lerp(-1.4, 0, eased);
        this.camera.position.y = lerp(7.2, 6.8, eased);
        this.camera.position.z = lerp(12.4, 11.8, eased);
        if (progress < 1) {
          requestAnimationFrame(animateIntro);
        }
      };
      requestAnimationFrame(animateIntro);
    }

    animate() {
      if (!this.usingThree || !this.scene || !this.camera || !this.renderer || !this.clock) {
        return;
      }
      const tick = () => {
        const delta = this.clock.getDelta();
        const elapsed = this.clock.elapsedTime;
        this.avatars.forEach((avatar, index) => {
          if (!avatar) {
            return;
          }
          const sway = Math.sin(elapsed * 1.4 + index) * 0.08;
          const bob = Math.sin(elapsed * 2 + index * 1.3) * 0.06;
          avatar.position.y = avatar.userData.baseY + bob;
          avatar.rotation.z = sway * 0.25;
          if (avatar.userData.reactionTimer > 0) {
            avatar.userData.reactionTimer -= delta;
            avatar.rotation.x = Math.sin(elapsed * 9) * 0.16;
          } else {
            avatar.rotation.x = 0;
          }
        });
        this.camera.lookAt(0, 0.4, 0);
        this.renderer.render(this.scene, this.camera);
        this.frameHandle = requestAnimationFrame(tick);
      };
      this.frameHandle = requestAnimationFrame(tick);
    }

    resize() {
      if (!this.usingThree || !this.camera || !this.renderer) {
        return;
      }
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;
      if (!width || !height) {
        return;
      }
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
    }
  }

  // AI heuristics stay readable on purpose: coherent, opportunistic, but imperfect.
  const AIStrategy = {
    chooseInitialRevealIndices(player) {
      return shuffle(player.cards.map((_, index) => index)).slice(0, 2);
    },

    evaluateTurn(round, playerIndex, difficulty) {
      const player = round.players[playerIndex];
      const discardCard = round.discardPile[round.discardPile.length - 1] || null;
      const discardDecision = discardCard
        ? this.evaluateCandidate(player, discardCard.value, difficulty, "discard")
        : null;
      const takeDiscard =
        discardDecision && (discardDecision.columnChance || discardDecision.delta <= -1.6);

      if (takeDiscard) {
        return { source: "discard", replaceIndex: discardDecision.index };
      }

      return { source: "deck" };
    },

    chooseAfterDraw(round, playerIndex, difficulty) {
      const player = round.players[playerIndex];
      const candidate = round.drawnCard.value;
      const useDecision = this.evaluateCandidate(player, candidate, difficulty, "deck");
      if (useDecision.columnChance || useDecision.delta <= -0.4) {
        return { action: "replace", replaceIndex: useDecision.index };
      }
      return { action: "discard", revealIndex: this.chooseRevealIndex(player) };
    },

    evaluateCandidate(player, value, difficulty, source) {
      const columnChance = this.findColumnCompletion(player, value);
      if (columnChance !== null) {
        return { index: columnChance, delta: -999, columnChance: true };
      }

      let best = { index: 0, delta: Infinity, columnChance: false };
      player.cards.forEach((card, index) => {
        if (card.cleared) {
          return;
        }
        let expected = card.faceUp ? card.value : 4.8 - difficulty * 0.35;
        if (!card.faceUp && value <= 0) {
          expected += 1.4;
        }
        if (!card.faceUp && value >= 8 && source === "discard") {
          expected -= 1.1;
        }
        const delta = value - expected;
        if (delta < best.delta) {
          best = { index, delta, columnChance: false };
        }
      });
      return best;
    },

    findColumnCompletion(player, value) {
      for (let column = 0; column < CARD_COLUMNS; column += 1) {
        const indices = [column, column + CARD_COLUMNS, column + CARD_COLUMNS * 2];
        const cards = indices.map((index) => player.cards[index]);
        const visibleMatches = cards.filter(
          (card) => card.faceUp && !card.cleared && card.value === value
        );
        if (visibleMatches.length === 2) {
          const targetIndex = indices.find(
            (cardIndex) =>
              !player.cards[cardIndex].cleared &&
              (!player.cards[cardIndex].faceUp || player.cards[cardIndex].value !== value)
          );
          if (typeof targetIndex === "number") {
            return targetIndex;
          }
        }
      }
      return null;
    },

    chooseRevealIndex(player) {
      for (let column = 0; column < CARD_COLUMNS; column += 1) {
        const indices = [column, column + CARD_COLUMNS, column + CARD_COLUMNS * 2];
        const cards = indices.map((index) => player.cards[index]);
        const visibleValues = cards
          .filter((card) => card.faceUp && !card.cleared)
          .map((card) => card.value);
        if (visibleValues.length === 2 && visibleValues[0] === visibleValues[1]) {
          const hiddenIndex = indices.find(
            (cardIndex) => !player.cards[cardIndex].faceUp && !player.cards[cardIndex].cleared
          );
          if (typeof hiddenIndex === "number") {
            return hiddenIndex;
          }
        }
      }
      const hiddenIndices = player.cards
        .map((card, index) => ({ card, index }))
        .filter(({ card }) => !card.faceUp && !card.cleared)
        .map(({ index }) => index);
      return hiddenIndices.length
        ? hiddenIndices[Math.floor(Math.random() * hiddenIndices.length)]
        : 0;
    },
  };

  // DOM wiring is kept in one place so the rest of the code can stay data-driven.
  function cacheDom() {
    APP.elements = {
      landingScreen: document.getElementById("landingScreen"),
      gameScreen: document.getElementById("gameScreen"),
      playButton: document.getElementById("playButton"),
      openRules: document.getElementById("openRules"),
      openRulesTop: document.getElementById("openRulesTop"),
      openOptions: document.getElementById("openOptions"),
      openOptionsTop: document.getElementById("openOptionsTop"),
      roundIndicator: document.getElementById("roundIndicator"),
      turnIndicator: document.getElementById("turnIndicator"),
      phaseIndicator: document.getElementById("phaseIndicator"),
      statusBanner: document.getElementById("statusBanner"),
      scoreStrip: document.getElementById("scoreStrip"),
      historyList: document.getElementById("historyList"),
      historyBadge: document.getElementById("historyBadge"),
      drawPile: document.getElementById("drawPile"),
      discardPile: document.getElementById("discardPile"),
      drawCount: document.getElementById("drawCount"),
      discardHint: document.getElementById("discardHint"),
      discardTop: document.getElementById("discardTop"),
      drawnCardSlot: document.getElementById("drawnCardSlot"),
      discardDrawnBtn: document.getElementById("discardDrawnBtn"),
      muteToggle: document.getElementById("muteToggle"),
      helpBtn: document.getElementById("helpBtn"),
      newRoundBtn: document.getElementById("newRoundBtn"),
      newGameBtn: document.getElementById("newGameBtn"),
      modalBackdrop: document.getElementById("modalBackdrop"),
      rulesModal: document.getElementById("rulesModal"),
      optionsModal: document.getElementById("optionsModal"),
      tutorialModal: document.getElementById("tutorialModal"),
      roundModal: document.getElementById("roundModal"),
      tutorialText: document.getElementById("tutorialText"),
      tutorialNextBtn: document.getElementById("tutorialNextBtn"),
      difficultySelect: document.getElementById("difficultySelect"),
      funModeToggle: document.getElementById("funModeToggle"),
      soundToggle: document.getElementById("soundToggle"),
      roundWinner: document.getElementById("roundWinner"),
      roundResults: document.getElementById("roundResults"),
      playAgainBtn: document.getElementById("playAgainBtn"),
      backToMenuBtn: document.getElementById("backToMenuBtn"),
      boards: CONFIG.players.map((_, index) => document.getElementById(`board-${index}`)),
      scoreTexts: CONFIG.players.map((_, index) => document.getElementById(`score-${index}`)),
      avatarScene: document.getElementById("avatarScene"),
      avatarFallback: document.getElementById("avatarFallback"),
      emotionLayer: document.getElementById("emotionLayer"),
      fxLayer: document.getElementById("fxLayer"),
    };
  }

  function bindEvents() {
    APP.elements.playButton.addEventListener("click", startGameFlow);
    APP.elements.openRules.addEventListener("click", () => openModal("rulesModal"));
    APP.elements.openRulesTop.addEventListener("click", () => openModal("rulesModal"));
    APP.elements.openOptions.addEventListener("click", () => openModal("optionsModal"));
    APP.elements.openOptionsTop.addEventListener("click", () => openModal("optionsModal"));
    APP.elements.helpBtn.addEventListener("click", showTutorial);
    APP.elements.newRoundBtn.addEventListener("click", () => {
      APP.audio.play("draw");
      startRound(true);
    });
    APP.elements.newGameBtn.addEventListener("click", () => {
      APP.audio.play("draw");
      APP.engine.resetMatch();
      startRound(true);
    });
    APP.elements.playAgainBtn.addEventListener("click", () => {
      closeModal("roundModal");
      startRound(true);
    });
    APP.elements.backToMenuBtn.addEventListener("click", () => {
      closeModal("roundModal");
      APP.elements.gameScreen.classList.add("is-hidden");
      APP.elements.landingScreen.classList.remove("is-hidden");
    });
    APP.elements.drawPile.addEventListener("click", onDrawPileClick);
    APP.elements.discardPile.addEventListener("click", onDiscardPileClick);
    APP.elements.discardDrawnBtn.addEventListener("click", onDiscardDrawnClick);
    APP.elements.muteToggle.addEventListener("click", toggleMute);
    APP.elements.tutorialNextBtn.addEventListener("click", onTutorialNext);
    APP.elements.difficultySelect.addEventListener("change", (event) => {
      CONFIG.difficulty = Number(event.target.value);
      persistSettings();
    });
    APP.elements.funModeToggle.addEventListener("change", (event) => {
      CONFIG.funMode = event.target.checked;
      persistSettings();
    });
    APP.elements.soundToggle.addEventListener("change", (event) => {
      CONFIG.soundEnabled = event.target.checked;
      APP.audio.setMuted(!CONFIG.soundEnabled);
      syncSoundControls();
      persistSettings();
    });

    document.querySelectorAll("[data-close-modal]").forEach((button) => {
      button.addEventListener("click", () => closeModal(button.dataset.closeModal));
    });

    APP.elements.modalBackdrop.addEventListener("click", () => {
      closeModal();
    });

    window.addEventListener("resize", () => {
      APP.avatars.resize();
    });

    document.addEventListener(
      "pointerdown",
      () => {
        APP.audio.unlock();
      },
      { once: true }
    );
  }

  async function initialize() {
    cacheDom();
    hydrateSettings();
    APP.engine = new GameEngine(CONFIG);
    APP.audio = new AudioEngine();
    APP.audio.setMuted(!CONFIG.soundEnabled);
    APP.avatars = new AvatarStage(
      APP.elements.avatarScene,
      APP.elements.avatarFallback,
      APP.elements.emotionLayer
    );
    bindEvents();
    syncSoundControls();
    APP.elements.difficultySelect.value = String(CONFIG.difficulty);
    APP.elements.funModeToggle.checked = CONFIG.funMode;
    APP.elements.soundToggle.checked = CONFIG.soundEnabled;
    await APP.avatars.init();
  }

  function hydrateSettings() {
    try {
      const stored = JSON.parse(localStorage.getItem(CONFIG.storageKey) || "{}");
      if (stored.difficulty) {
        CONFIG.difficulty = Number(stored.difficulty);
      }
      if (typeof stored.funMode === "boolean") {
        CONFIG.funMode = stored.funMode;
      }
      if (typeof stored.soundEnabled === "boolean") {
        CONFIG.soundEnabled = stored.soundEnabled;
      }
    } catch (error) {
      console.warn("Impossible de lire les paramètres sauvegardés.", error);
    }
  }

  function persistSettings() {
    try {
      localStorage.setItem(
        CONFIG.storageKey,
        JSON.stringify({
          difficulty: CONFIG.difficulty,
          funMode: CONFIG.funMode,
          soundEnabled: CONFIG.soundEnabled,
        })
      );
    } catch (error) {
      console.warn("Impossible d'enregistrer les paramètres.", error);
    }
  }

  function syncSoundControls() {
    APP.elements.muteToggle.textContent = CONFIG.soundEnabled ? "Son activé" : "Son coupé";
    APP.elements.soundToggle.checked = CONFIG.soundEnabled;
  }

  async function startGameFlow() {
    APP.audio.play("good");
    APP.elements.landingScreen.classList.add("is-hidden");
    APP.elements.gameScreen.classList.remove("is-hidden");
    APP.avatars.resize();
    await startRound(false);
  }

  async function startRound(skipTutorialCheck) {
    APP.roundToken += 1;
    const token = APP.roundToken;
    closeModal();
    APP.aiLock = false;
    APP.engine.startRound();
    APP.avatars.introSweep();
    renderAll(true);
    APP.avatars.resize();
    await wait(DEAL_DURATION);
    if (token !== APP.roundToken) {
      return;
    }
    APP.engine.finishDeal();
    renderAll();
    if (!skipTutorialCheck && !localStorage.getItem(CONFIG.tutorialKey)) {
      showTutorial();
    }
    maybeRunAiTurn(token);
  }

  function showTutorial() {
    APP.tutorialStep = 0;
    APP.elements.tutorialText.textContent = CONFIG.tutorialSteps[APP.tutorialStep];
    openModal("tutorialModal");
  }

  function onTutorialNext() {
    APP.tutorialStep += 1;
    if (APP.tutorialStep >= CONFIG.tutorialSteps.length) {
      localStorage.setItem(CONFIG.tutorialKey, "1");
      closeModal("tutorialModal");
      return;
    }
    APP.elements.tutorialText.textContent = CONFIG.tutorialSteps[APP.tutorialStep];
  }

  function openModal(id) {
    const modalIds = ["rulesModal", "optionsModal", "tutorialModal", "roundModal"];
    modalIds.forEach((modalId) => {
      APP.elements[modalId].classList.toggle("is-hidden", modalId !== id);
    });
    APP.elements.modalBackdrop.classList.remove("is-hidden");
  }

  function closeModal(targetId) {
    const modalIds = ["rulesModal", "optionsModal", "tutorialModal", "roundModal"];
    modalIds.forEach((modalId) => {
      if (!targetId || modalId === targetId) {
        APP.elements[modalId].classList.add("is-hidden");
      }
    });
    const stillOpen = modalIds.some((modalId) => !APP.elements[modalId].classList.contains("is-hidden"));
    APP.elements.modalBackdrop.classList.toggle("is-hidden", !stillOpen);
  }

  function toggleMute() {
    CONFIG.soundEnabled = !CONFIG.soundEnabled;
    APP.audio.setMuted(!CONFIG.soundEnabled);
    APP.audio.play(CONFIG.soundEnabled ? "good" : "bad");
    syncSoundControls();
    persistSettings();
  }

  function onDrawPileClick() {
    if (APP.aiLock || !APP.engine.round || APP.engine.round.phase !== "await-draw") {
      return;
    }
    const result = APP.engine.drawFromDeck();
    if (!result.ok) {
      return;
    }
    APP.audio.play("draw");
    renderAll();
  }

  function onDiscardPileClick() {
    if (APP.aiLock || !APP.engine.round || APP.engine.round.phase !== "await-draw") {
      return;
    }
    const result = APP.engine.takeDiscard();
    if (!result.ok) {
      return;
    }
    APP.audio.play("draw");
    renderAll();
  }

  function onDiscardDrawnClick() {
    if (APP.aiLock || !APP.engine.round) {
      return;
    }
    const result = APP.engine.discardDrawnCard();
    if (!result.ok) {
      return;
    }
    APP.audio.play("bad");
    renderAll();
    maybeRunAiTurn();
  }

  function handleBoardClick(playerIndex, cardIndex, cardElement) {
    if (APP.aiLock || playerIndex !== 0 || !APP.engine.round) {
      return;
    }
    const phase = APP.engine.round.phase;
    if (phase === "initial-reveal") {
      const result = APP.engine.revealInitialCard(cardIndex);
      if (!result.ok) {
        return;
      }
      APP.audio.play("flip");
      spawnScoreFx(cardElement, formatCardValue(result.value), "flip");
      renderAll();
      maybeRunAiTurn();
      return;
    }
    if (phase === "await-replace-or-discard") {
      const result = APP.engine.replaceCurrentPlayerCard(cardIndex);
      if (!result.ok) {
        return;
      }
      APP.audio.play("swap");
      spawnScoreFx(cardElement, formatCardValue(result.newValue), "good");
      handleClearEffects(playerIndex, result.clears);
      renderAll();
      maybeShowReaction(playerIndex, result.newValue, result.oldValue, result.clears.length);
      maybeRunAiTurn();
      return;
    }
    if (phase === "await-reveal-after-discard") {
      const result = APP.engine.revealCurrentPlayerCard(cardIndex);
      if (!result.ok) {
        return;
      }
      APP.audio.play("flip");
      spawnScoreFx(cardElement, formatCardValue(result.value), "flip");
      handleClearEffects(playerIndex, result.clears);
      renderAll();
      maybeShowReaction(playerIndex, result.value, 4, result.clears.length);
      maybeRunAiTurn();
    }
  }

  function maybeShowReaction(playerIndex, newValue, oldValue, clearCount) {
    const delta = newValue - oldValue;
    if (clearCount > 0) {
      APP.avatars.react(playerIndex, "good", CONFIG.funMode ? "😎" : "🙂");
      APP.audio.play("score");
      shakeScreen();
      return;
    }
    if (delta <= -3 || newValue <= 0) {
      APP.avatars.react(playerIndex, "good", CONFIG.funMode ? "😎" : "🙂");
      APP.audio.play("good");
    } else if (delta >= 3 || newValue >= 9) {
      APP.avatars.react(playerIndex, "bad", CONFIG.funMode ? "😵" : "😬");
      APP.audio.play("bad");
    } else {
      APP.avatars.react(playerIndex, "neutral", CONFIG.funMode ? "🙂" : "😬");
    }
  }

  async function maybeRunAiTurn(token = APP.roundToken) {
    if (token !== APP.roundToken) {
      return;
    }
    if (!APP.engine.round || APP.engine.round.phase === "round-end") {
      if (APP.engine.round && APP.engine.round.phase === "round-end") {
        showRoundResults();
      }
      return;
    }
    APP.avatars.setActive(APP.engine.round.phase === "initial-reveal" ? 0 : APP.engine.round.turnIndex);
    renderAll();
    const current = APP.engine.getCurrentPlayer();
    if (!current || current.human || APP.aiLock) {
      return;
    }
    APP.aiLock = true;
    await wait(AI_DELAY);
    if (token !== APP.roundToken) {
      APP.aiLock = false;
      return;
    }
    await runSingleAiTurn(APP.engine.round.turnIndex, token);
    if (token !== APP.roundToken) {
      APP.aiLock = false;
      return;
    }
    APP.aiLock = false;
    renderAll();
    if (APP.engine.round.phase === "round-end") {
      showRoundResults();
      return;
    }
    if (!APP.engine.getCurrentPlayer().human) {
      maybeRunAiTurn(token);
    }
  }

  async function runSingleAiTurn(playerIndex, token) {
    if (token !== APP.roundToken) {
      return;
    }
    const decision = AIStrategy.evaluateTurn(APP.engine.round, playerIndex, CONFIG.difficulty);
    if (decision.source === "discard") {
      APP.engine.takeDiscard();
      APP.audio.play("draw");
      renderAll();
      await wait(AI_DELAY * 0.6);
      if (token !== APP.roundToken) {
        return;
      }
      const result = APP.engine.replaceCurrentPlayerCard(decision.replaceIndex);
      APP.audio.play("swap");
      const playerCard = getCardElement(playerIndex, decision.replaceIndex);
      if (playerCard) {
        spawnScoreFx(playerCard, formatCardValue(result.newValue), "good");
      }
      handleClearEffects(playerIndex, result.clears);
      APP.avatars.react(
        playerIndex,
        result.newValue <= 1 || result.clears.length ? "good" : "neutral",
        result.clears.length ? "😎" : "🙂"
      );
      renderAll();
      return;
    }

    APP.engine.drawFromDeck();
    APP.audio.play("draw");
    renderAll();
    await wait(AI_DELAY * 0.7);
    if (token !== APP.roundToken) {
      return;
    }
    const afterDraw = AIStrategy.chooseAfterDraw(APP.engine.round, playerIndex, CONFIG.difficulty);
    if (afterDraw.action === "replace") {
      const result = APP.engine.replaceCurrentPlayerCard(afterDraw.replaceIndex);
      APP.audio.play("swap");
      handleClearEffects(playerIndex, result.clears);
      APP.avatars.react(
        playerIndex,
        result.newValue <= 1 || result.clears.length ? "good" : "neutral",
        result.clears.length ? "😎" : result.newValue <= 1 ? "🙂" : "😬"
      );
      renderAll();
      return;
    }

    APP.engine.discardDrawnCard();
    APP.audio.play("bad");
    renderAll();
    await wait(AI_DELAY * 0.55);
    if (token !== APP.roundToken) {
      return;
    }
    if (APP.engine.round.phase === "await-reveal-after-discard") {
      const result = APP.engine.revealCurrentPlayerCard(afterDraw.revealIndex);
      APP.audio.play("flip");
      handleClearEffects(playerIndex, result.clears);
      APP.avatars.react(
        playerIndex,
        result.value <= 1 || result.clears.length ? "good" : "bad",
        result.clears.length ? "😎" : result.value <= 1 ? "🙂" : "😬"
      );
      renderAll();
    }
  }

  function handleClearEffects(playerIndex, clears) {
    if (!clears || clears.length === 0) {
      return;
    }
    shakeScreen();
    APP.audio.play("score");
    clears.forEach((clear) => {
      const cardElement = getCardElement(playerIndex, clear.column);
      if (cardElement) {
        spawnScoreFx(cardElement, "COLONNE!", "score");
      }
    });
  }

  // UI rendering rebuilds the visible board state from the engine after each action.
  function renderAll(withDealAnimation = false) {
    if (!APP.engine.round) {
      return;
    }
    const { round } = APP.engine;
    const currentPlayer = APP.engine.getCurrentPlayer();
    const aiThinking =
      currentPlayer &&
      !currentPlayer.human &&
      round.phase !== "initial-reveal" &&
      round.phase !== "round-end";
    APP.elements.roundIndicator.textContent = String(APP.engine.match.roundNumber);
    APP.elements.turnIndicator.textContent =
      round.phase === "initial-reveal" ? "Préparation" : currentPlayer.name;
    APP.elements.phaseIndicator.textContent = aiThinking ? "IA en réflexion" : phaseLabel(round.phase);
    APP.elements.statusBanner.textContent = round.statusText;
    APP.elements.drawCount.textContent = `${round.deck.length} cartes`;
    APP.elements.discardHint.textContent = round.discardPile.length ? "Disponible" : "Vide";
    if (round.discardPile.length) {
      const discardCard = APP.engine.getTopDiscard();
      APP.elements.discardTop.textContent = formatCardValue(discardCard.value);
      APP.elements.discardTop.dataset.tone = cardTone(discardCard.value);
    } else {
      APP.elements.discardTop.textContent = "--";
      delete APP.elements.discardTop.dataset.tone;
    }
    APP.elements.drawPile.classList.toggle(
      "active-pile",
      round.phase === "await-draw" && currentPlayer.human
    );
    APP.elements.discardPile.classList.toggle(
      "active-pile",
      round.phase === "await-draw" && currentPlayer.human && round.discardPile.length > 0
    );

    renderDrawnCard();
    renderScoreStrip();
    renderHistory();
    renderBoards(withDealAnimation);
    APP.avatars.setActive(round.phase === "initial-reveal" ? 0 : round.turnIndex);
  }

  function renderDrawnCard() {
    const { round } = APP.engine;
    APP.elements.drawnCardSlot.innerHTML = "";
    if (round.drawnCard) {
      const preview = document.createElement("div");
      preview.className = "drawn-preview";
      preview.dataset.tone = cardTone(round.drawnCard.value);
      preview.textContent = formatCardValue(round.drawnCard.value);
      APP.elements.drawnCardSlot.appendChild(preview);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "drawn-placeholder";
      placeholder.textContent = "En main";
      APP.elements.drawnCardSlot.appendChild(placeholder);
    }
    APP.elements.discardDrawnBtn.disabled =
      !(round.phase === "await-replace-or-discard" && round.drawnSource === "deck");
    APP.elements.discardDrawnBtn.textContent =
      APP.engine.getHiddenCount(APP.engine.getHumanPlayer()) > 0
        ? "Défausser / retourner"
        : "Défausser";
  }

  function renderScoreStrip() {
    APP.elements.scoreStrip.innerHTML = "";
    APP.engine.round.players.forEach((player, index) => {
      const chip = document.createElement("div");
      chip.className = "score-chip";
      chip.classList.toggle(
        "active",
        APP.engine.round.turnIndex === index && APP.engine.round.phase !== "initial-reveal"
      );
      chip.innerHTML = `
        <span class="score-chip-name">${player.name}</span>
        <span class="score-chip-value">${APP.engine.match.players[index].totalScore} pts</span>
        <span class="score-chip-name">Visible ${APP.engine.getVisibleScore(player)} · Cachées ${APP.engine.getHiddenCount(player)}</span>
      `;
      APP.elements.scoreStrip.appendChild(chip);
      APP.elements.scoreTexts[index].textContent =
        `Visible ${APP.engine.getVisibleScore(player)} · Cachées ${APP.engine.getHiddenCount(player)}`;
      const seat = document.querySelector(`.seat[data-player-index="${index}"]`);
      seat.classList.toggle(
        "active-seat",
        APP.engine.round.phase !== "initial-reveal" && APP.engine.round.turnIndex === index
      );
    });
  }

  function renderHistory() {
    APP.elements.historyList.innerHTML = "";
    APP.engine.round.history.slice(0, 4).forEach((entry) => {
      const item = document.createElement("li");
      item.textContent = entry;
      APP.elements.historyList.appendChild(item);
    });
    APP.elements.historyBadge.textContent = String(APP.engine.round.history.length);
  }

  function renderBoards(withDealAnimation) {
    APP.engine.round.players.forEach((player, playerIndex) => {
      const board = APP.elements.boards[playerIndex];
      board.innerHTML = "";
      player.cards.forEach((card, cardIndex) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "card-button";
        button.dataset.player = String(playerIndex);
        button.dataset.card = String(cardIndex);
        button.style.setProperty("--deal-delay", `${(cardIndex + playerIndex * 2) * 44}ms`);
        button.style.setProperty("--float-offset", String((cardIndex + playerIndex) % 6));
        if (withDealAnimation) {
          button.classList.add("deal-in");
        }
        if (card.cleared) {
          button.classList.add("cleared");
        }
        if (isCardSelectable(playerIndex, cardIndex)) {
          button.classList.add("selectable");
        }
        const shell = document.createElement("div");
        shell.className = "card-shell";
        if (card.faceUp || card.cleared) {
          shell.classList.add("is-face-up");
        }

        const back = document.createElement("div");
        back.className = "card-back";
        back.innerHTML = "<span>Skygrô</span>";

        const face = document.createElement("div");
        face.className = "card-face";
        if (card.cleared) {
          face.classList.add("cleared-face");
          face.innerHTML = '<span class="card-value">VOID</span>';
        } else {
          face.dataset.tone = cardTone(card.value);
          face.innerHTML = `<span class="card-value">${formatCardValue(card.value)}</span>`;
        }

        shell.appendChild(face);
        shell.appendChild(back);
        button.appendChild(shell);
        button.addEventListener("click", () => handleBoardClick(playerIndex, cardIndex, button));
        board.appendChild(button);
      });
    });
  }

  function isCardSelectable(playerIndex, cardIndex) {
    if (playerIndex !== 0 || !APP.engine.round || APP.aiLock) {
      return false;
    }
    const card = APP.engine.round.players[playerIndex].cards[cardIndex];
    if (!card || card.cleared) {
      return false;
    }
    const phase = APP.engine.round.phase;
    if (phase === "initial-reveal") {
      return !card.faceUp;
    }
    if (phase === "await-replace-or-discard") {
      return Boolean(APP.engine.round.drawnCard);
    }
    if (phase === "await-reveal-after-discard") {
      return !card.faceUp;
    }
    return false;
  }

  function getCardElement(playerIndex, cardIndex) {
    return APP.elements.boards[playerIndex]?.querySelector(
      `.card-button[data-card="${cardIndex}"]`
    );
  }

  function spawnScoreFx(cardElement, text, kind) {
    if (!cardElement) {
      return;
    }
    const rect = cardElement.getBoundingClientRect();
    const fx = document.createElement("div");
    fx.className = "score-pop";
    fx.textContent = text;
    fx.style.left = `${rect.left + rect.width / 2}px`;
    fx.style.top = `${rect.top + rect.height / 2}px`;
    fx.style.color = kind === "score" ? "#ffd977" : kind === "good" ? "#6fffe1" : "#ffffff";
    APP.elements.fxLayer.appendChild(fx);
    setTimeout(() => fx.remove(), 900);
  }

  function showRoundResults() {
    const ranking = [...APP.engine.round.players]
      .map((player, index) => ({
        ...player,
        totalScore: APP.engine.match.players[index].totalScore,
      }))
      .sort((a, b) => a.roundScore - b.roundScore);
    APP.elements.roundWinner.textContent = APP.engine.round.winnerText;
    APP.elements.roundResults.innerHTML = "";
    ranking.forEach((player, index) => {
      const row = document.createElement("div");
      row.className = "result-row";
      row.innerHTML = `
        <div class="result-rank">${index + 1}</div>
        <div>
          <strong>${player.name}</strong>
          <div>Manche ${player.roundScore} pts · Total ${player.totalScore} pts</div>
        </div>
        <div>${index === 0 ? "Leader" : ""}</div>
      `;
      APP.elements.roundResults.appendChild(row);
    });
    openModal("roundModal");
  }

  function shakeScreen() {
    document.body.classList.remove("screen-shake");
    void document.body.offsetWidth;
    document.body.classList.add("screen-shake");
    setTimeout(() => document.body.classList.remove("screen-shake"), 480);
  }

  function phaseLabel(phase) {
    const labels = {
      dealing: "Distribution",
      "initial-reveal": "Préparation",
      "await-draw": "Choix de pile",
      "await-replace-or-discard": "Choix de carte",
      "await-reveal-after-discard": "Retourne une carte",
      "round-end": "Fin de manche",
    };
    return labels[phase] || phase;
  }

  function cardTone(value) {
    if (value < 0) {
      return "minus";
    }
    if (value <= 2) {
      return "low";
    }
    if (value <= 6) {
      return "mid";
    }
    if (value <= 9) {
      return "warm";
    }
    return "hot";
  }

  function formatCardValue(value) {
    return value > 0 ? `+${value}` : String(value);
  }

  function markFaceUp(card) {
    return { ...card, faceUp: true };
  }

  async function ensureThreeAvailable() {
    if (window.THREE) {
      return;
    }
    try {
      await loadScriptOnce(CONFIG.threeScripts[0], "three-core");
      await loadScriptOnce(CONFIG.threeScripts[1], "three-gltf-loader");
    } catch (error) {
      console.warn("Three.js indisponible, fallback avatar activé.", error);
    }
  }

  function loadScriptOnce(src, key) {
    const existing = document.querySelector(`script[data-loader-key="${key}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") {
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), {
          once: true,
        });
      });
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timeoutId = window.setTimeout(() => {
        reject(new Error(`Timeout while loading ${src}`));
      }, 4500);
      script.src = src;
      script.async = true;
      script.defer = true;
      script.dataset.loaderKey = key;
      script.addEventListener(
        "load",
        () => {
          window.clearTimeout(timeoutId);
          script.dataset.loaded = "true";
          resolve();
        },
        { once: true }
      );
      script.addEventListener(
        "error",
        () => {
          window.clearTimeout(timeoutId);
          reject(new Error(`Failed to load ${src}`));
        },
        { once: true }
      );
      document.head.appendChild(script);
    });
  }

  function wait(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function shuffle(array) {
    const result = [...array];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
  }

  function lerp(start, end, progress) {
    return start + (end - start) * progress;
  }

  function easeOutCubic(value) {
    return 1 - Math.pow(1 - value, 3);
  }

  function showBootError(error) {
    console.error("Skygro bootstrap error:", error);
    const banner = document.createElement("div");
    banner.className = "boot-error";
    banner.textContent =
      "Le script du jeu n'a pas démarré correctement. Recharge la page ou vide le cache du navigateur.";
    document.body.appendChild(banner);
  }

  window.addEventListener("DOMContentLoaded", () => {
    initialize().catch(showBootError);
  });
})();
