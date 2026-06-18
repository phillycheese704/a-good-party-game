import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = process.env.PORT || 3001;
const MAX_PLAYERS = 16;
const PICK_TIME = 30;
const LEADERBOARD_TIME = 5;
const REACTION_CLICK_WINDOW = 4500;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const miniGames = ["Reaction", "Tig", "Hot Potato", "Coin Grab", "Maze Escape"];

const botNames = [
  "Bot Barry",
  "Tin Tim",
  "Potato Pete",
  "Mega Susan",
  "Captain Click",
  "Zoom Goblin",
  "Coin Carl",
  "Maze Mabel",
  "Panic Pam",
  "Turbo Terry",
  "Sneaky Steve",
  "Robot Rita",
  "Waffle Bot",
  "Noodle Ned",
  "Chaos Chris",
];

const rooms = {};

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ],
    methods: ["GET", "POST"],
  },
});

app.use(express.static(path.join(__dirname, "dist")));

app.get("/health", (request, response) => {
  response.send("Good Party Game server is running.");
});

app.use((request, response) => {
  response.sendFile(path.join(__dirname, "dist", "index.html"));
});

function makeRoomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let i = 0; i < 6; i++) {
    code += letters[Math.floor(Math.random() * letters.length)];
  }

  if (rooms[code]) {
    return makeRoomCode();
  }

  return code;
}

function hasBrackets(text) {
  return /[()[\]{}<>]/.test(text);
}

function getRandomGameName() {
  return miniGames[Math.floor(Math.random() * miniGames.length)];
}

function getUnusedBotName(room) {
  const usedNames = room.players.map((player) => player.name);
  const unusedName = botNames.find((botName) => !usedNames.includes(botName));

  if (unusedName) {
    return unusedName;
  }

  return `Bot ${room.players.length}`;
}

function getDisplayName(player) {
  if (player.type === "bot") {
    return `${player.name} (bot)`;
  }

  return player.name;
}

function getReactionPoints(place) {
  const points = [1000, 800, 600, 400, 250, 150, 100, 50];
  return points[place - 1] || 0;
}

function makeTimers() {
  return {
    pick: null,
    countdown: null,
    wait: null,
    reactionFinish: null,
    leaderboard: null,
    bots: [],
  };
}

function cleanRoomForClient(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    pickTimeLeft: room.pickTimeLeft,
    gameQueue: room.gameQueue,
    players: room.players,
    scores: room.scores,
    currentGameIndex: room.currentGameIndex,
    currentGameName: room.currentGameName,
    leaderboardTimeLeft: room.leaderboardTimeLeft,
    roundResults: room.roundResults,
    finalResults: room.finalResults,
    reaction: room.reaction,
  };
}

function sendRoom(roomCode) {
  const room = rooms[roomCode];

  if (!room) {
    return;
  }

  io.to(roomCode).emit("room_updated", cleanRoomForClient(room));
}

function clearTimer(room, timerName) {
  if (room.timers[timerName]) {
    clearTimeout(room.timers[timerName]);
    clearInterval(room.timers[timerName]);
    room.timers[timerName] = null;
  }
}

function clearBotTimers(room) {
  room.timers.bots.forEach((timer) => clearTimeout(timer));
  room.timers.bots = [];
}

function clearGameTimers(room) {
  clearTimer(room, "countdown");
  clearTimer(room, "wait");
  clearTimer(room, "reactionFinish");
  clearTimer(room, "leaderboard");
  clearBotTimers(room);
}

function stopPickTimer(room) {
  clearTimer(room, "pick");
}

function resetRoomToLobby(room) {
  stopPickTimer(room);
  clearGameTimers(room);

  room.phase = "lobby";
  room.pickTimeLeft = PICK_TIME;
  room.gameQueue = [];
  room.scores = {};
  room.currentGameIndex = 0;
  room.currentGameName = "";
  room.leaderboardTimeLeft = LEADERBOARD_TIME;
  room.roundResults = [];
  room.finalResults = [];
  room.reaction = null;

  room.players = room.players.map((player) => ({
    ...player,
    selectedGame: "",
  }));
}

function finalizePicks(roomCode) {
  const room = rooms[roomCode];

  if (!room) {
    return;
  }

  stopPickTimer(room);

  room.players = room.players.map((player) => {
    if (player.selectedGame) {
      return player;
    }

    return {
      ...player,
      selectedGame: getRandomGameName(),
    };
  });

  room.gameQueue = room.players.map((player) => ({
    playerId: player.id,
    playerName: player.name,
    gameName: player.selectedGame,
  }));

  room.phase = "ready";
  sendRoom(roomCode);
}

function startPickTimer(roomCode) {
  const room = rooms[roomCode];

  if (!room) {
    return;
  }

  stopPickTimer(room);

  room.pickTimeLeft = PICK_TIME;

  room.timers.pick = setInterval(() => {
    const currentRoom = rooms[roomCode];

    if (!currentRoom) {
      return;
    }

    currentRoom.pickTimeLeft -= 1;

    if (currentRoom.pickTimeLeft <= 0) {
      finalizePicks(roomCode);
      return;
    }

    sendRoom(roomCode);
  }, 1000);
}

function chooseNewHost(room) {
  const humanPlayer = room.players.find((player) => player.type === "human");

  if (!humanPlayer) {
    return;
  }

  room.hostId = humanPlayer.id;

  room.players = room.players.map((player) => ({
    ...player,
    isHost: player.id === room.hostId,
  }));
}

function removePlayerFromRooms(socketId, socketObject = null) {
  Object.values(rooms).forEach((room) => {
    const wasInRoom = room.players.some((player) => player.id === socketId);

    if (!wasInRoom) {
      return;
    }

    if (socketObject) {
      socketObject.leave(room.code);
    }

    room.players = room.players.filter((player) => player.id !== socketId);

    if (room.players.length === 0) {
      stopPickTimer(room);
      clearGameTimers(room);
      delete rooms[room.code];
      return;
    }

    if (room.hostId === socketId) {
      chooseNewHost(room);
    }

    sendRoom(room.code);
  });
}

function startMatch(roomCode) {
  const room = rooms[roomCode];

  if (!room) {
    return;
  }

  clearGameTimers(room);

  const scores = {};

  room.players.forEach((player) => {
    scores[player.id] = 0;
  });

  room.scores = scores;
  room.currentGameIndex = 0;
  room.roundResults = [];
  room.finalResults = [];

  startCurrentGame(roomCode, 0);
}

function startCurrentGame(roomCode, gameIndex) {
  const room = rooms[roomCode];

  if (!room) {
    return;
  }

  clearGameTimers(room);

  if (gameIndex >= room.gameQueue.length) {
    finishMatch(roomCode);
    return;
  }

  const queueItem = room.gameQueue[gameIndex];

  room.currentGameIndex = gameIndex;
  room.currentGameName = queueItem.gameName;
  room.roundResults = [];
  room.leaderboardTimeLeft = LEADERBOARD_TIME;
  room.reaction = null;

  if (queueItem.gameName === "Reaction") {
    startReaction(roomCode);
    return;
  }

  finishComingSoonGame(roomCode);
}

function startReaction(roomCode) {
  const room = rooms[roomCode];

  if (!room) {
    return;
  }

  room.phase = "reaction";
  room.reaction = {
    phase: "countdown",
    countdown: 3,
    status: "Get ready...",
    goAt: null,
    results: [],
  };

  sendRoom(roomCode);

  room.timers.countdown = setInterval(() => {
    const currentRoom = rooms[roomCode];

    if (!currentRoom || currentRoom.phase !== "reaction") {
      return;
    }

    currentRoom.reaction.countdown -= 1;

    if (currentRoom.reaction.countdown <= 0) {
      clearTimer(currentRoom, "countdown");
      startReactionWaiting(roomCode);
      return;
    }

    sendRoom(roomCode);
  }, 1000);
}

function startReactionWaiting(roomCode) {
  const room = rooms[roomCode];

  if (!room || room.phase !== "reaction") {
    return;
  }

  room.reaction.phase = "waiting";
  room.reaction.status = "Wait for it...";
  sendRoom(roomCode);

  const waitTime = 1200 + Math.floor(Math.random() * 2200);

  room.timers.wait = setTimeout(() => {
    startReactionGo(roomCode);
  }, waitTime);
}

function startReactionGo(roomCode) {
  const room = rooms[roomCode];

  if (!room || room.phase !== "reaction") {
    return;
  }

  room.reaction.phase = "go";
  room.reaction.status = "GO!";
  room.reaction.goAt = Date.now();

  sendRoom(roomCode);

  room.players.forEach((player) => {
    if (player.type !== "bot") {
      return;
    }

    const botMisses = Math.random() < 0.1;
    const botIsVerySlow = Math.random() < 0.25;

    let reactionTime = 700 + Math.floor(Math.random() * 1500);

    if (botIsVerySlow) {
      reactionTime += 800 + Math.floor(Math.random() * 1100);
    }

    if (botMisses) {
      return;
    }

    const botTimer = setTimeout(() => {
      addReactionResult(roomCode, {
        playerId: player.id,
        status: "clicked",
        reactionTime,
      });
    }, reactionTime);

    room.timers.bots.push(botTimer);
  });

  room.timers.reactionFinish = setTimeout(() => {
    const currentRoom = rooms[roomCode];

    if (!currentRoom || currentRoom.phase !== "reaction") {
      return;
    }

    currentRoom.players.forEach((player) => {
      const hasResult = currentRoom.reaction.results.some(
        (result) => result.playerId === player.id
      );

      if (!hasResult) {
        currentRoom.reaction.results.push({
          playerId: player.id,
          status: "missed",
          reactionTime: null,
        });
      }
    });

    finishReaction(roomCode);
  }, REACTION_CLICK_WINDOW);
}

function addReactionResult(roomCode, newResult) {
  const room = rooms[roomCode];

  if (!room || room.phase !== "reaction" || !room.reaction) {
    return;
  }

  if (room.reaction.phase === "finished") {
    return;
  }

  const alreadyHasResult = room.reaction.results.some(
    (result) => result.playerId === newResult.playerId
  );

  if (alreadyHasResult) {
    return;
  }

  room.reaction.results.push(newResult);
  sendRoom(roomCode);

  if (room.reaction.results.length >= room.players.length) {
    finishReaction(roomCode);
  }
}

function finishReaction(roomCode) {
  const room = rooms[roomCode];

  if (!room || room.phase !== "reaction" || !room.reaction) {
    return;
  }

  if (room.reaction.phase === "finished") {
    return;
  }

  clearGameTimers(room);

  room.reaction.phase = "finished";

  const resultsByPlayer = {};

  room.reaction.results.forEach((result) => {
    resultsByPlayer[result.playerId] = result;
  });

  const completeResults = room.players.map((player) => {
    const result = resultsByPlayer[player.id];

    if (result) {
      return {
        ...result,
        player,
      };
    }

    return {
      playerId: player.id,
      player,
      status: "missed",
      reactionTime: null,
    };
  });

  const clickedResults = completeResults
    .filter((result) => result.status === "clicked")
    .sort((a, b) => a.reactionTime - b.reactionTime);

  const notClickedResults = completeResults.filter(
    (result) => result.status !== "clicked"
  );

  const sortedResults = [...clickedResults, ...notClickedResults];

  room.roundResults = sortedResults.map((result, index) => {
    const place = index + 1;
    const points = result.status === "clicked" ? getReactionPoints(place) : 0;

    room.scores[result.player.id] =
      (room.scores[result.player.id] || 0) + points;

    return {
      playerId: result.player.id,
      name: getDisplayName(result.player),
      type: result.player.type,
      status: result.status,
      reactionTime: result.reactionTime,
      points,
      totalScore: room.scores[result.player.id],
    };
  });

  room.phase = "roundLeaderboard";
  startLeaderboardTimer(roomCode);
  sendRoom(roomCode);
}

function finishComingSoonGame(roomCode) {
  const room = rooms[roomCode];

  if (!room) {
    return;
  }

  room.roundResults = room.players
    .map((player) => ({
      playerId: player.id,
      name: getDisplayName(player),
      type: player.type,
      status: "coming-soon",
      reactionTime: null,
      points: 0,
      totalScore: room.scores[player.id] || 0,
    }))
    .sort((a, b) => b.totalScore - a.totalScore);

  room.phase = "roundLeaderboard";
  startLeaderboardTimer(roomCode);
  sendRoom(roomCode);
}

function startLeaderboardTimer(roomCode) {
  const room = rooms[roomCode];

  if (!room) {
    return;
  }

  clearTimer(room, "leaderboard");

  room.leaderboardTimeLeft = LEADERBOARD_TIME;

  room.timers.leaderboard = setInterval(() => {
    const currentRoom = rooms[roomCode];

    if (!currentRoom) {
      return;
    }

    currentRoom.leaderboardTimeLeft -= 1;

    if (currentRoom.leaderboardTimeLeft <= 0) {
      goToNextGame(roomCode);
      return;
    }

    sendRoom(roomCode);
  }, 1000);
}

function goToNextGame(roomCode) {
  const room = rooms[roomCode];

  if (!room) {
    return;
  }

  clearTimer(room, "leaderboard");

  const nextIndex = room.currentGameIndex + 1;

  if (nextIndex >= room.gameQueue.length) {
    finishMatch(roomCode);
    return;
  }

  startCurrentGame(roomCode, nextIndex);
}

function finishMatch(roomCode) {
  const room = rooms[roomCode];

  if (!room) {
    return;
  }

  clearGameTimers(room);

  room.finalResults = room.players
    .map((player) => ({
      playerId: player.id,
      name: getDisplayName(player),
      type: player.type,
      score: room.scores[player.id] || 0,
    }))
    .sort((a, b) => b.score - a.score);

  room.phase = "finalResults";
  sendRoom(roomCode);
}

io.on("connection", (socket) => {
  socket.emit("connected", socket.id);

  socket.on("create_room", ({ name }) => {
    const cleanName = String(name || "").trim();

    if (!cleanName) {
      socket.emit("room_error", "Type your name first.");
      return;
    }

    if (hasBrackets(cleanName)) {
      socket.emit("room_error", "Names cannot use brackets: ( ) [ ] { } < >");
      return;
    }

    removePlayerFromRooms(socket.id, socket);

    const code = makeRoomCode();

    const room = {
      code,
      hostId: socket.id,
      phase: "lobby",
      pickTimeLeft: PICK_TIME,
      timers: makeTimers(),
      gameQueue: [],
      players: [
        {
          id: socket.id,
          name: cleanName,
          type: "human",
          isHost: true,
          selectedGame: "",
        },
      ],
      scores: {},
      currentGameIndex: 0,
      currentGameName: "",
      leaderboardTimeLeft: LEADERBOARD_TIME,
      roundResults: [],
      finalResults: [],
      reaction: null,
    };

    rooms[code] = room;
    socket.join(code);
    sendRoom(code);
  });

  socket.on("join_room", ({ name, code }) => {
    const cleanName = String(name || "").trim();
    const cleanCode = String(code || "").trim().toUpperCase();
    const room = rooms[cleanCode];

    if (!cleanName) {
      socket.emit("room_error", "Type your name first.");
      return;
    }

    if (hasBrackets(cleanName)) {
      socket.emit("room_error", "Names cannot use brackets: ( ) [ ] { } < >");
      return;
    }

    if (!room) {
      socket.emit("room_error", "That room does not exist.");
      return;
    }

    if (room.phase !== "lobby") {
      socket.emit("room_error", "That room has already started.");
      return;
    }

    if (room.players.length >= MAX_PLAYERS) {
      socket.emit("room_error", "That room is full.");
      return;
    }

    removePlayerFromRooms(socket.id, socket);

    room.players.push({
      id: socket.id,
      name: cleanName,
      type: "human",
      isHost: false,
      selectedGame: "",
    });

    socket.join(cleanCode);
    sendRoom(cleanCode);
  });

  socket.on("leave_room", ({ roomCode }) => {
    const cleanCode = String(roomCode || "").trim().toUpperCase();

    if (rooms[cleanCode]) {
      socket.leave(cleanCode);
    }

    removePlayerFromRooms(socket.id, socket);
  });

  socket.on("add_bot", ({ roomCode }) => {
    const room = rooms[String(roomCode || "").toUpperCase()];

    if (!room) {
      socket.emit("room_error", "Room not found.");
      return;
    }

    if (room.hostId !== socket.id) {
      socket.emit("room_error", "Only the host can add bots.");
      return;
    }

    if (room.players.length >= MAX_PLAYERS) {
      socket.emit("room_error", "You can only have 16 players in one room.");
      return;
    }

    room.players.push({
      id: `bot-${Date.now()}-${Math.random()}`,
      name: getUnusedBotName(room),
      type: "bot",
      isHost: false,
      selectedGame: "",
    });

    sendRoom(room.code);
  });

  socket.on("remove_bot", ({ roomCode, botId }) => {
    const room = rooms[String(roomCode || "").toUpperCase()];

    if (!room) {
      socket.emit("room_error", "Room not found.");
      return;
    }

    if (room.hostId !== socket.id) {
      socket.emit("room_error", "Only the host can remove bots.");
      return;
    }

    room.players = room.players.filter((player) => player.id !== botId);
    sendRoom(room.code);
  });

  socket.on("start_picking", ({ roomCode }) => {
    const room = rooms[String(roomCode || "").toUpperCase()];

    if (!room) {
      socket.emit("room_error", "Room not found.");
      return;
    }

    if (room.hostId !== socket.id) {
      socket.emit("room_error", "Only the host can start the game.");
      return;
    }

    room.phase = "choosing";
    room.gameQueue = [];
    room.players = room.players.map((player) => ({
      ...player,
      selectedGame: "",
    }));

    startPickTimer(room.code);
    sendRoom(room.code);
  });

  socket.on("select_game", ({ roomCode, gameName }) => {
    const room = rooms[String(roomCode || "").toUpperCase()];

    if (!room) {
      socket.emit("room_error", "Room not found.");
      return;
    }

    if (!miniGames.includes(gameName)) {
      socket.emit("room_error", "That mini-game does not exist.");
      return;
    }

    room.players = room.players.map((player) => {
      if (player.id !== socket.id) {
        return player;
      }

      return {
        ...player,
        selectedGame: gameName,
      };
    });

    sendRoom(room.code);
  });

  socket.on("skip_pick_timer", ({ roomCode }) => {
    const room = rooms[String(roomCode || "").toUpperCase()];

    if (!room) {
      socket.emit("room_error", "Room not found.");
      return;
    }

    if (room.hostId !== socket.id) {
      socket.emit("room_error", "Only the host can skip the timer.");
      return;
    }

    finalizePicks(room.code);
  });

  socket.on("start_match", ({ roomCode }) => {
    const room = rooms[String(roomCode || "").toUpperCase()];

    if (!room) {
      socket.emit("room_error", "Room not found.");
      return;
    }

    if (room.hostId !== socket.id) {
      socket.emit("room_error", "Only the host can start the match.");
      return;
    }

    startMatch(room.code);
  });

  socket.on("reaction_click", ({ roomCode }) => {
    const room = rooms[String(roomCode || "").toUpperCase()];

    if (!room || room.phase !== "reaction" || !room.reaction) {
      return;
    }

    const player = room.players.find((currentPlayer) => currentPlayer.id === socket.id);

    if (!player) {
      return;
    }

    const alreadyHasResult = room.reaction.results.some(
      (result) => result.playerId === player.id
    );

    if (alreadyHasResult) {
      return;
    }

    if (room.reaction.phase === "countdown" || room.reaction.phase === "waiting") {
      addReactionResult(room.code, {
        playerId: player.id,
        status: "false-start",
        reactionTime: null,
      });
      return;
    }

    if (room.reaction.phase === "go") {
      addReactionResult(room.code, {
        playerId: player.id,
        status: "clicked",
        reactionTime: Date.now() - room.reaction.goAt,
      });
    }
  });

  socket.on("next_game", ({ roomCode }) => {
    const room = rooms[String(roomCode || "").toUpperCase()];

    if (!room) {
      return;
    }

    if (room.hostId !== socket.id) {
      socket.emit("room_error", "Only the host can skip ahead.");
      return;
    }

    goToNextGame(room.code);
  });

  socket.on("back_to_lobby", ({ roomCode }) => {
    const room = rooms[String(roomCode || "").toUpperCase()];

    if (!room) {
      return;
    }

    if (room.hostId !== socket.id) {
      socket.emit("room_error", "Only the host can go back to the lobby.");
      return;
    }

    resetRoomToLobby(room);
    sendRoom(room.code);
  });

  socket.on("disconnect", () => {
    removePlayerFromRooms(socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Good Party Game server running on port ${PORT}`);
});
