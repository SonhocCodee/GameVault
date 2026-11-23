# GameVault 🎮

GameVault is a personal game library manager and playtime tracker built with Electron, React, and TypeScript.

## Features

- **Game Library**: Manage and track your personal game collection.
- **Playtime Tracker**: Real-time play duration tracking, FPS monitor, and hardware metrics.
- **Game Covers & Media**: Automatic and curated covers, screenshots, and media capture.
- **Cloud Sync**: Google Login, Firestore integration for reviews & leaderboards, Google Drive integration for private save backups.
- **Save Manager**: Automatic save detection, backup, and restore.

## Tech Stack

- **Framework**: [Electron](https://www.electronjs.org/)
- **Frontend**: [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Tailwind CSS](https://tailwindcss.com/)
- **Bundler**: [Vite](https://vitejs.dev/)
- **Database/Cloud**: Firebase / Google Cloud (Firestore, Drive API, OAuth)

## Getting Started

### Prerequisites

- Node.js (v18+ recommended)
- npm / yarn / pnpm

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Cloud Setup

For setting up Google Login, Firestore, and Drive backup, see [SETUP.md](./SETUP.md).

## License

ISC
