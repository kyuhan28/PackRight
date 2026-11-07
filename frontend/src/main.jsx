import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import PickupBoard from "./PickupBoard.jsx";

import App from "./App.jsx";
import "./styles.css";

// /board (or ?board) is the public pickup screen: no login, order numbers only.
const showBoard = /\/board\/?$/.test(location.pathname) || new URLSearchParams(location.search).has("board");

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {showBoard ? <PickupBoard /> : <App />}
  </StrictMode>
);
