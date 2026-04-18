# SignalMap Backend Server

Express.js сервер для SignalMap/GeoCorp мобильного приложения.

## Запуск

```bash
cd server
npm install
npm start
```

Сервер запустится на `http://localhost:3001`

## API Endpoints

### Аутентификация
- `POST /api/auth/send-otp` - Отправить OTP код на email
- `POST /api/auth/verify-otp` - Верифицировать OTP и войти/зарегистрироваться

### Пользователь
- `GET /api/me` - Получить профиль пользователя
- `GET /api/leaderboard` - Таблица лидеров
- `GET /api/transactions` - История транзакций

### Signal Mapping (DePIN)
- `POST /api/readings` - Отправить данные о сигнале
- `GET /api/coverage` - Получить heatmap покрытия
- `GET /api/coverage/detailed` - Детальные данные (требует auth)
- `GET /api/mapper/stats` - Статистика маппера

### Faucet
- `POST /api/faucet` - Получить тестовые FLOW токены (0.5 FLOW, кулдаун 1 час)

### B2B Challenges
- `POST /api/challenges/create` - Создать bounty challenge
- `GET /api/challenges` - Список всех challenges
- `GET /api/challenges/:id` - Детали конкретного challenge

### QR Code System
- `POST /api/qr/issue` - Выпустить QR код для бизнеса
- `POST /api/qr/verify` - Верифицировать QR код (пользователь сканирует)
- `GET /api/qr/list` - Список выпущенных QR кодов
- `GET /api/qr/active` - Активные QR коды поблизости
- `GET /api/visits` - История посещений пользователя

## Environment Variables

Все переменные окружения уже настроены в `.env` файле в корне проекта.

## Smart Contracts

Контракты развернуты на Flow Testnet (chain ID 545):
- **GeoCorp (ERC721 NFT)**: `0x616e6907FBAd7CDCC18075b67B4119119B478FEf`
- **TrustReceipts (ERC-8004 SBT)**: `0x3AFC288E6b7bD6c69dBa622EE57659f450BC1D61`
- **ChallengeManager (Escrow)**: `0xA3E1f07aED2d1120FABF75dd0B8a6a5523fcAd25`

## AI Oracle

Используется OpenRouter с моделью `google/gemini-3-flash-preview` для верификации фото.
