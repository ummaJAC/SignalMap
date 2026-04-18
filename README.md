# SignalMap

**DePIN Cellular Coverage Intelligence Network**

SignalMap turns smartphones into cellular signal measurement nodes. Contributors earn FLOW token rewards for mapping real-world network coverage — data that telecom operators and IoT companies pay millions within Drive Testing budgets to collect.

## Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌──────────────────┐
│  Mobile App     │────▶│  Backend API │────▶│  Flow EVM        │
│  (React Native) │     │  (Express)   │     │  (Trust Receipts)│
│                 │     │              │     │  ERC-8004        │
│  Native Android │     │  Supabase    │     └──────────────────┘
│  Sensor Module  │     │  IPFS/Pinata │
└─────────────────┘     └──────────────┘
```

## What Data We Collect

Each reading captures hardware-sourced RF data via a custom Android native module (`CellularInfoModule.kt`):

| Data Point | Source | Value |
|---|---|---|
| Signal Strength | `TelephonyManager` | dBm (e.g. -85) |
| Carrier | `TelephonyManager` | China Mobile, T-Mobile, etc. |
| Network Generation | `TelephonyManager` | 3G / LTE / 5G |
| GPS Coordinates | `expo-location` | lat/lng |
| Wi-Fi Density | `NetInfo` | nearby AP count |

Data is **not spoofable** — it comes directly from the device's radio chipset, not from any API.

## On-Chain Verification

Every validated reading is minted as an **ERC-8004 Trust Receipt** on Flow EVM Testnet:

- `TrustReceipts`: `0x3AFC288E6b7bD6c69dBa622EE57659f450BC1D61`
- `ChallengeManager`: `0xA3E1f07aED2d1120FABF75dd0B8a6a5523fcAd25`
- Chain: Flow EVM Testnet (Chain ID: 545)

## Tech Stack

- **Mobile**: React Native (Expo) + Custom Kotlin Native Modules
- **Backend**: Node.js / Express
- **Database**: Supabase (PostgreSQL)
- **Storage**: IPFS via Pinata
- **Blockchain**: Flow EVM (Solidity contracts)
- **State**: Zustand + AsyncStorage (persistent)

## Project Structure

```
├── src/
│   ├── screens/          # App screens (Map, Login, Profile)
│   ├── services/
│   │   ├── api.ts        # Backend API client with safety catch failover
│   │   └── signalCollector.ts  # Signal data collection orchestrator
│   └── store/
│       └── useMapperStore.ts   # Persistent state (Zustand + AsyncStorage)
├── android/
│   └── app/src/main/java/com/knayx/signalmap/
│       ├── CellularInfoModule.kt   # Native bridge: TelephonyManager → JS
│       └── CellularInfoPackage.kt  # RN package registration
├── server/
│   ├── index.js          # Express API server
│   ├── auth.js           # Authentication routes
│   └── supabaseClient.js # Database client
└── railway.json          # Deployment config
```

## Setup

```bash
# Install dependencies
npm install
cd server && npm install && cd ..

# Copy env template and fill in your keys
cp .env.example .env

# Run mobile app + backend concurrently
npm run dev:all
```

## License

MIT
