import { useEffect, useState } from "react";
import "./App.css";
import { socket } from "./socket";

const MAX_PLAYERS = 16;

const miniGames = [
  { name: "Reaction", emoji: "⚡", description: "Wait for GO, then click faster than everyone else.", difficulty: "Easy" },
  { name: "Tig", emoji: "🏃", description: "Run, tag, escape. Least tagged player wins.", difficulty: "Medium" },
  { name: "Hot Potato", emoji: "🥔", description: "Pass the potato before it explodes.", difficulty: "Medium" },
  { name: "Coin Grab", emoji: "🪙", description: "Collect the most coins before time runs out.", difficulty: "Medium" },
  { name: "Maze Escape", emoji: "🧩", description: "Race through the maze and escape first.", difficulty: "Hard" },
];

function getGameEmoji(gameName) {
  const game = miniGames.find((miniGame) => miniGame.name === gameName);
  return game ? game.emoji : "🎮";
}

function getDisplayName(player) {
  return player.type === "bot" ? `${player.name} (bot)` : player.name;
}

function getResultText(result) {
  if (result.status === "clicked") return `${result.reactionTime}ms`;
  if (result.status === "false-start") return "False start";
  if (result.status === "missed") return "Missed";
  return "Coming soon";
}

function App() {
  const [screen, setScreen] = useState("name");
  const [playerName, setPlayerName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [room, setRoom] = useState(null);
  const [socketId, setSocketId] = useState("");
  const [popup, setPopup] = useState(null);

  const myPlayer = room?.players.find((player) => player.id === socketId);
  const isHost = Boolean(myPlayer?.isHost);
  const myReactionResult = room?.reaction?.results.find((result) => result.playerId === socketId);

  function showPopup(title, message) { setPopup({ title, message }); }
  function closePopup() { setPopup(null); }

  function startSetup() {
    const cleanName = playerName.trim();
    if (!cleanName) { showPopup("Name needed", "Type your name before starting."); return; }
    if (/[()[\]{}<>]/.test(cleanName)) { showPopup("Name not allowed", "Please do not use brackets in your name: ( ) [ ] { } < >"); return; }
    setPlayerName(cleanName);
    setScreen("roomMenu");
  }

  function createRoom() { socket.emit("create_room", { name: playerName }); }
  function joinRoom() { socket.emit("join_room", { name: playerName, code: joinCode }); }
  function leaveRoom() { if (room) socket.emit("leave_room", { roomCode: room.code }); setRoom(null); setScreen("roomMenu"); }
  function addBot() { socket.emit("add_bot", { roomCode: room.code }); }
  function removeBot(botId) { socket.emit("remove_bot", { roomCode: room.code, botId }); }
  function startPicking() { socket.emit("start_picking", { roomCode: room.code }); }
  function selectGame(gameName) { socket.emit("select_game", { roomCode: room.code, gameName }); }
  function skipPickTimer() { socket.emit("skip_pick_timer", { roomCode: room.code }); }
  function startMatch() { socket.emit("start_match", { roomCode: room.code }); }
  function reactionClick() { if (room) socket.emit("reaction_click", { roomCode: room.code }); }
  function nextGame() { socket.emit("next_game", { roomCode: room.code }); }
  function backToLobby() { socket.emit("back_to_lobby", { roomCode: room.code }); }

  function getReactionBigText() {
    if (!room?.reaction) return "⚡";
    if (room.reaction.phase === "countdown") return room.reaction.countdown;
    if (room.reaction.phase === "waiting") return "WAIT";
    if (room.reaction.phase === "go") return "GO!";
    return "DONE";
  }

  function getReactionSmallText() {
    if (!room?.reaction) return "";
    if (room.reaction.phase === "countdown") return "Starting in";
    if (room.reaction.phase === "waiting") return "Careful...";
    if (room.reaction.phase === "go") return "Click now!";
    return "Round finished";
  }

  function getMyReactionMessage() {
    if (!myReactionResult) return room?.reaction?.status || "";
    if (myReactionResult.status === "clicked") return `You clicked in ${myReactionResult.reactionTime}ms`;
    if (myReactionResult.status === "false-start") return "Too early! False start.";
    return "You missed!";
  }

  useEffect(() => {
    function handleConnected(id) { setSocketId(id); }
    function handleRoomUpdated(updatedRoom) {
      setRoom(updatedRoom);
      if (updatedRoom.phase === "lobby") setScreen("lobby");
      if (updatedRoom.phase === "choosing") setScreen("chooseGame");
      if (updatedRoom.phase === "ready") setScreen("ready");
      if (updatedRoom.phase === "reaction") setScreen("reaction");
      if (updatedRoom.phase === "roundLeaderboard") setScreen("roundLeaderboard");
      if (updatedRoom.phase === "finalResults") setScreen("finalResults");
    }
    function handleRoomError(message) { showPopup("Oops", message); }
    socket.on("connected", handleConnected);
    socket.on("room_updated", handleRoomUpdated);
    socket.on("room_error", handleRoomError);
    return () => {
      socket.off("connected", handleConnected);
      socket.off("room_updated", handleRoomUpdated);
      socket.off("room_error", handleRoomError);
    };
  }, []);

  return (
    <div className="app">
      <div className="backgroundBlob blobOne"></div>
      <div className="backgroundBlob blobTwo"></div>
      <div className="backgroundBlob blobThree"></div>

      {popup && (
        <div className="popupOverlay">
          <div className="popupCard">
            <div className="popupIcon">✨</div>
            <h2>{popup.title}</h2>
            <p>{popup.message}</p>
            <button className="primaryButton" onClick={closePopup}>Got it</button>
          </div>
        </div>
      )}

      <header className="topBar">
        <div className="logo"><span className="logoIcon">🎮</span><span>Good Party Game</span></div>
        <div className="statusPill">
          {screen === "name" && "Start"}
          {screen === "roomMenu" && "Rooms"}
          {screen === "lobby" && `${room?.players.length || 1}/${MAX_PLAYERS}`}
          {screen === "chooseGame" && `${room?.pickTimeLeft || 0}s`}
          {screen === "ready" && "Ready"}
          {screen === "reaction" && "Reaction"}
          {screen === "roundLeaderboard" && `Next ${room?.leaderboardTimeLeft || 0}s`}
          {screen === "finalResults" && "Final"}
        </div>
      </header>

      {screen === "name" && (
        <main className="screen">
          <section className="mainCard startCard">
            <p className="eyebrow">Online party chaos</p>
            <h1>Good Party Game</h1>
            <p className="subtitle">Pick mini-games, win points, and become champion.</p>
            <div className="nameBox">
              <label>Your name</label>
              <input placeholder="Example: PhillyCheese" value={playerName} onChange={(event) => setPlayerName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") startSetup(); }} />
            </div>
            <button className="megaButton" onClick={startSetup}>START</button>
            <div className="miniGameStrip"><span>⚡ Reaction</span><span>🏃 Tig</span><span>🥔 Hot Potato</span><span>🪙 Coin Grab</span><span>🧩 Maze Escape</span></div>
          </section>
        </main>
      )}

      {screen === "roomMenu" && (
        <main className="screen">
          <section className="mainCard">
            <p className="eyebrow">Welcome, {playerName}</p>
            <h1>Join the party</h1>
            <p className="subtitle">Create a room or join one with a code.</p>
            <div className="roomActions">
              <div className="actionPanel"><h2>Create</h2><p>Start a new online room and invite your friends.</p><button className="primaryButton" onClick={createRoom}>Create Room</button></div>
              <div className="actionPanel"><h2>Join</h2><p>Enter your friend’s 6-character room code.</p><input placeholder="ABC123" maxLength="6" value={joinCode} onChange={(event) => setJoinCode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") joinRoom(); }} /><button className="secondaryButton" onClick={joinRoom}>Join Room</button></div>
            </div>
            <button className="ghostButton small" onClick={() => setScreen("name")}>Back</button>
          </section>
        </main>
      )}

      {screen === "lobby" && room && (
        <main className="screen">
          <section className="mainCard lobbyCard">
            <p className="eyebrow">{isHost ? "You are host" : "Waiting for host"}</p>
            <h1>Lobby</h1>
            <div className="codeBox"><span>Room Code</span><strong>{room.code}</strong></div>
            <div className="playersPanel">
              <div className="panelHeader"><h2>Players</h2><span className="countBadge">{room.players.length}/{MAX_PLAYERS}</span></div>
              <div className="playerList">
                {room.players.map((player) => (
                  <div className="miniPlayer" key={player.id}>
                    <div className="avatar smallAvatar">{player.name.charAt(0).toUpperCase()}</div>
                    <div className="miniPlayerInfo"><strong>{getDisplayName(player)}</strong><span>{player.isHost && "Host"}{player.type === "bot" && "AI Bot"}{player.id === socketId && !player.isHost && "You"}{player.type === "human" && player.id !== socketId && !player.isHost && "Player"}</span></div>
                    {isHost && player.type === "bot" && <button className="removeBotButton" onClick={() => removeBot(player.id)}>×</button>}
                  </div>
                ))}
              </div>
              {isHost && <button className="secondaryButton fullWidth" onClick={addBot} disabled={room.players.length >= MAX_PLAYERS}>{room.players.length >= MAX_PLAYERS ? "Room Full" : "Add AI Bot"}</button>}
            </div>
            <div className="buttonRow"><button className="ghostButton" onClick={leaveRoom}>Leave</button>{isHost ? <button className="primaryButton" onClick={startPicking}>Start Game</button> : <button className="primaryButton" disabled>Waiting for Host</button>}</div>
          </section>
        </main>
      )}

      {screen === "chooseGame" && room && (
        <main className="screen">
          <section className="mainCard pickCard">
            <div className="pickTop"><div><p className="eyebrow">Pick synced online</p><h1>Choose mini-game</h1></div><div className="timerBox"><span>Pick timer</span><strong>{room.pickTimeLeft}s</strong></div></div>
            <div className="gameGrid">
              {miniGames.map((game) => <button key={game.name} className={myPlayer?.selectedGame === game.name ? "miniGameCard chosen" : "miniGameCard"} onClick={() => selectGame(game.name)}><span className="gameEmoji">{game.emoji}</span><h2>{game.name}</h2><p>{game.description}</p><small>{game.difficulty}</small></button>)}
            </div>
            <div className="pickBottom">
              <div className="selectedBox compact"><span>Your pick</span><strong>{myPlayer?.selectedGame || "None yet"}</strong></div>
              <div className="onlinePickList">{room.players.map((player) => <div key={player.id}><span>{getDisplayName(player)}</span><strong>{player.selectedGame ? `${getGameEmoji(player.selectedGame)} ${player.selectedGame}` : "Choosing..."}</strong></div>)}</div>
              <p className="tinyNote">If time runs out, missing picks are chosen randomly.</p>
              <div className="buttonRow">{isHost ? <><button className="ghostButton" onClick={backToLobby}>Back</button><button className="primaryButton" onClick={skipPickTimer}>Skip Timer</button></> : <button className="primaryButton" disabled>Waiting for Host</button>}</div>
            </div>
          </section>
        </main>
      )}

      {screen === "ready" && room && (
        <main className="screen">
          <section className="mainCard readyCard">
            <p className="eyebrow">Everyone is locked in</p><h1>Ready!</h1>
            <div className="gameQueue"><h2>Mini-game queue</h2><div className="queueList">{room.gameQueue.map((queueItem) => <div className="queueItem" key={queueItem.playerId}><span>{queueItem.playerName}{queueItem.playerId.startsWith("bot-") ? " (bot)" : ""}</span><strong>{getGameEmoji(queueItem.gameName)} {queueItem.gameName}</strong></div>)}</div></div>
            <div className="buttonRow">{isHost ? <><button className="ghostButton" onClick={backToLobby}>Back to Lobby</button><button className="primaryButton" onClick={startMatch}>Start Match</button></> : <button className="primaryButton" disabled>Waiting for Host</button>}</div>
          </section>
        </main>
      )}

      {screen === "reaction" && room && room.reaction && (
        <main className="screen">
          <section className="mainCard reactionCard">
            <p className="eyebrow">Round {room.currentGameIndex + 1} of {room.gameQueue.length}</p>
            <h1>⚡ Reaction</h1>
            <button className={room.reaction.phase === "go" ? "reactionButton reactionGo" : "reactionButton"} onClick={reactionClick} disabled={Boolean(myReactionResult)}><span>{getReactionSmallText()}</span><strong>{getReactionBigText()}</strong></button>
            <p className="reactionStatus">{getMyReactionMessage()}</p>
            <div className="reactionInfo"><span>{room.reaction.results.length}/{room.players.length} finished</span><span>Bots are slower now 😄</span></div>
          </section>
        </main>
      )}

      {screen === "roundLeaderboard" && room && (
        <main className="screen">
          <section className="mainCard leaderboardCard">
            <p className="eyebrow">Round {room.currentGameIndex + 1} complete</p>
            <h1>{getGameEmoji(room.currentGameName)} {room.currentGameName}</h1>
            {room.currentGameName !== "Reaction" && <p className="subtitle">This mini-game is coming soon, so nobody gets points yet.</p>}
            <div className="kahootBoard">{room.roundResults.map((result, index) => <div className="kahootRow" key={result.playerId}><div className="placeBadge">#{index + 1}</div><div className="kahootName"><strong>{result.name}</strong><span>{getResultText(result)}</span></div><div className="pointsBox"><strong>+{result.points}</strong><span>{result.totalScore} total</span></div></div>)}</div>
            <div className="buttonRow">{isHost ? <><button className="ghostButton" onClick={nextGame}>Next Now</button><button className="primaryButton" onClick={nextGame}>Next in {room.leaderboardTimeLeft}s</button></> : <button className="primaryButton" disabled>Next in {room.leaderboardTimeLeft}s</button>}</div>
          </section>
        </main>
      )}

      {screen === "finalResults" && room && (
        <main className="screen">
          <section className="mainCard leaderboardCard">
            <p className="eyebrow">Game over</p><h1>🏆 Final Results</h1>
            {room.finalResults.length > 0 && <div className="winnerBox"><span>Champion</span><strong>{room.finalResults[0].name}</strong></div>}
            <div className="kahootBoard">{room.finalResults.map((entry, index) => <div className="kahootRow" key={entry.playerId}><div className="placeBadge">#{index + 1}</div><div className="kahootName"><strong>{entry.name}</strong><span>{entry.type === "bot" ? "AI Bot" : "Human"}</span></div><div className="pointsBox"><strong>{entry.score}</strong><span>points</span></div></div>)}</div>
            <div className="buttonRow">{isHost ? <><button className="ghostButton" onClick={backToLobby}>Back to Lobby</button><button className="primaryButton" onClick={startPicking}>Play Again</button></> : <button className="primaryButton" disabled>Waiting for Host</button>}</div>
          </section>
        </main>
      )}
    </div>
  );
}

export default App;
