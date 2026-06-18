import { io } from "socket.io-client";

const serverUrl = window.location.hostname === "localhost"
  ? "http://localhost:3001"
  : window.location.origin;

export const socket = io(serverUrl);
