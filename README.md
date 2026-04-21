# SignalMap

**Verifiable telecom coverage intelligence on Flow**

SignalMap is a DePIN coverage intelligence network built on Flow. It turns everyday smartphones into mobile sensing nodes that collect real-world cellular and Wi-Fi quality data while users move through real environments.

On the mapper side, users log in, start mapping, and earn testnet FLOW for verified contributions. On the operator side, verified readings are aggregated into a live dashboard that surfaces coverage cells, mapper activity, rewards paid, and network quality by area.

The result is a dual-sided product:

- a consumer crypto experience for contributors
- a verifiable infrastructure intelligence product for operators and infrastructure teams

## Links

- GitHub: [SignalMap Repository](https://github.com/ummaJAC/SignalMap)
- Live Dashboard: [SignalMap Operator Dashboard](https://signalmap-production.up.railway.app/dashboard)
- Android APK: [Download SignalMap APK](https://drive.google.com/file/d/1ZrXraUD3wg8dYab1IR_F910tEW9_iCyw/view?usp=sharing)
- Demo Video: [Watch Demo](https://youtu.be/4geL9xD2qxU?si=4ZukFeTd3V0ZAx0D)

## Why SignalMap Exists

Traditional network mapping is expensive, episodic, and operationally heavy. Telecom operators and infrastructure teams often rely on drive-testing fleets, fragmented field measurements, and delayed reporting to understand real coverage quality.

SignalMap takes a different approach. Instead of a small number of specialized measurement vehicles, it uses a distributed network of mobile users to collect real-world network conditions continuously. This creates a more scalable and more current picture of how connectivity actually performs across areas, routes, and transport conditions.

The most useful readings come from real movement through the world, not from a single static point. That makes SignalMap relevant to both sides of the network:

- contributors earn for useful, verified participation
- operators gain a continuously refreshed view of network quality

## Product Overview

SignalMap currently includes:

- an Android mobile app for login, mapping, rewards, history, and wallet proof
- a backend verification and reward pipeline built with Express and Supabase
- Flow EVM integration for ERC-8004 Trust Receipts and reward attribution
- an operator dashboard for viewing verified samples, coverage clusters, mappers, and network quality

## System Architecture

```text
+------------------------+      +---------------------------+      +----------------------------+
| Mobile App             |      | Backend / Verification    |      | Flow EVM                   |
| React Native + Expo    | ---> | Express API               | ---> | ERC-8004 Trust Receipts    |
|                        |      | Supabase                  |      | reward attribution         |
| Native Android module  |      | sessionization            |      | auditable contribution log |
| signal + wifi telemetry|      | quality / reward pipeline |      +----------------------------+
+------------------------+      +---------------------------+
           |
           v
+------------------------+
| Operator Dashboard     |
| coverage cells         |
| mapper activity        |
| rewards paid           |
| live network quality   |
+------------------------+
```

## Data Flow

SignalMap works as an end-to-end pipeline:

1. A mapper logs in and starts mapping from the mobile app.
2. The app collects device telemetry such as carrier, transport, signal, and related quality fields.
3. Readings are sent to the backend API.
4. The backend validates, enriches, and processes accepted readings.
5. Rewardable readings are linked to mapper identity and payout logic.
6. Accepted contributions receive an ERC-8004 Trust Receipt on Flow EVM.
7. Mapper-facing screens update session history, rewards, and contribution stats.
8. Operator-facing surfaces update coverage and quality views by area.

## What SignalMap Collects

The app uses a native Android bridge in [`CellularInfoModule.kt`](./android/app/src/main/java/com/knayx/signalmap/CellularInfoModule.kt) to capture device-level network telemetry.

Typical reading fields include:

| Field | Example |
|---|---|
| Carrier | `beeline` |
| SIM operator | `beeline` |
| Transport type | `wifi`, `cellular` |
| Network generation | `2G`, `3G`, `4G`, `5G` |
| Signal strength | dBm / ASU |
| Cell identifiers | TAC, PCI, CID, LAC, NR/LTE identifiers when available |
| Wi-Fi metadata | SSID, RSSI, link speed, frequency |
| Location | latitude / longitude |
| Quality metrics | download speed, upload speed, latency when probed |

These readings are sourced from device telemetry and OS-level APIs, then validated and processed by the backend before being surfaced as accepted rewards or operator-facing intelligence.

## Trust Layer On Flow

SignalMap uses Flow EVM as a trust and provenance layer for verified readings.

For accepted contributions:

- the backend processes the reading
- reward attribution is recorded
- an ERC-8004 Trust Receipt is minted for the contribution flow

This creates a durable, auditable record of:

- who contributed
- which reading was accepted
- when it was processed
- how it was rewarded

Current on-chain references:

- `TrustReceipts`: `0x3AFC288E6b7bD6c69dBa622EE57659f450BC1D61`
- `ChallengeManager`: `0xA3E1f07aED2d1120FABF75dd0B8a6a5523fcAd25`
- Chain: `Flow EVM Testnet`

## Core Product Surfaces

### Mobile App

The mobile app is the contributor-facing surface. It currently supports:

- email login
- live mapping
- background collection flow
- session telemetry
- rewards and earned FLOW
- history and timeline views
- wallet proof and reward visibility

Key files:

- [`App.tsx`](./App.tsx)
- [`src/screens/LoginScreen.tsx`](./src/screens/LoginScreen.tsx)
- [`src/screens/MapScreen.tsx`](./src/screens/MapScreen.tsx)
- [`src/screens/HistoryScreen.tsx`](./src/screens/HistoryScreen.tsx)
- [`src/screens/ProfileScreen.tsx`](./src/screens/ProfileScreen.tsx)

### Backend

The backend is responsible for authentication, reading ingestion, verification, persistence, mapper stats, history, rewards, and dashboard data.

Key files:

- [`server/index.js`](./server/index.js)
- [`server/auth.js`](./server/auth.js)
- [`server/supabaseClient.js`](./server/supabaseClient.js)

### Operator Dashboard

The dashboard is the infrastructure-facing surface for coverage intelligence. It aggregates:

- verified samples
- coverage clusters / cells
- mapper activity
- rewards paid
- live raw network feed

Key file:

- [`server/public/dashboard.html`](./server/public/dashboard.html)

## Repository Structure

```text
.
|-- App.tsx
|-- app.json
|-- assets/
|-- android/
|   `-- app/src/main/java/com/knayx/signalmap/
|       |-- CellularInfoModule.kt
|       `-- CellularInfoPackage.kt
|-- src/
|   |-- components/
|   |-- screens/
|   |   |-- LoginScreen.tsx
|   |   |-- MapScreen.tsx
|   |   |-- HistoryScreen.tsx
|   |   `-- ProfileScreen.tsx
|   |-- services/
|   |   |-- api.ts
|   |   |-- backgroundMapping.ts
|   |   `-- signalCollector.ts
|   `-- store/
|       `-- useMapperStore.ts
|-- server/
|   |-- auth.js
|   |-- index.js
|   |-- supabaseClient.js
|   |-- migrations/
|   `-- public/
|       `-- dashboard.html
`-- railway.json
```

## Tech Stack

- **Mobile**: React Native, Expo, TypeScript
- **Native Android**: Kotlin bridge for telephony and Wi-Fi telemetry
- **State**: Zustand + AsyncStorage
- **Maps**: Mapbox (mobile), Leaflet/OpenStreetMap (dashboard)
- **Backend**: Node.js, Express
- **Database**: Supabase / PostgreSQL
- **Blockchain**: Flow EVM, Solidity contracts, ERC-8004 Trust Receipts
- **Deployment**: Railway

## Local Development

### App

```bash
npm install
npm start
```

### Backend

```bash
cd server
npm install
npm start
```

### Run App + Backend Together

```bash
npm run dev:all
```

## Environment Notes

SignalMap depends on environment configuration for:

- Supabase
- Flow EVM contract interaction
- authentication / OTP
- map configuration
- deployment secrets

Project-specific values should be provided through local environment files and deployment settings.

## Current Status

SignalMap is a live MVP with an end-to-end loop already implemented:

- users can log in
- start mapping
- submit readings
- receive confirmed rewards
- see history and profile stats
- inspect wallet proof and reward state
- and surface verified coverage intelligence in an operator dashboard

This repository represents a working product path from mobile sensing to backend verification to on-chain trust and operator-facing utility.

## License

MIT
