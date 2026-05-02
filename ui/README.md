# 0x Golden Goose Web UI

This is a premium, real-time web dashboard for the 0x Golden Goose trading swarm. It is built as a React Single Page Application (SPA) using Vite and styled with modern Vanilla CSS.

## Features

- **Real-Time Data**: Polls the backend API (`/api/stats`) every second to display live metrics from the PriceScout, RiskManager, and Executor agents.
- **Dynamic Configuration**: Connect to a local backend (`http://localhost:3001`) or a remote backend via an ngrok tunnel directly from the UI.
- **Premium Design**: Dark-mode aesthetic with glassmorphism, vibrant accents, and smooth animations.
- **Firebase Ready**: Built as a pure SPA, making it 100% compatible with static hosting services like Firebase Hosting.

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

3. Open your browser to `http://localhost:5173`.

> **Note**: Make sure the main 0x Golden Goose backend is running in a separate terminal (`npm run dev` in the root directory) so the UI has an API to connect to!

## Connecting to a Remote Swarm

If you want to host this UI on a server or Firebase but connect it to your local machine running the agent swarm:

1. Use `ngrok` to expose your local backend port:
   ```bash
   npx ngrok http 3001
   ```
2. Open the UI in your browser.
3. In the header's "Backend URL" input field, replace `http://localhost:3001` with your secure `ngrok` URL (e.g., `https://random-words.ngrok-free.dev`). The UI will instantly reconnect.

## Firebase Deployment

Because this is a static SPA, it is perfectly suited for Firebase Hosting.

1. Build the production assets:
   ```bash
   npm run build
   ```
   *This creates a `dist` folder containing all optimized HTML, JS, and CSS.*

2. Initialize Firebase (if you haven't already):
   ```bash
   npx firebase-tools init hosting
   ```
   *When asked for the public directory, specify `dist`.*
   *When asked if it is a single-page app, say `Yes`.*

3. Deploy:
   ```bash
   npx firebase-tools deploy --only hosting
   ```
