# ManLv Backend

Node.js backend for ManLv email parsing application.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up PostgreSQL database and update `DATABASE_URL` in `.env`.

3. Run Prisma migrations:
   ```bash
   npx prisma migrate dev --name init
   ```

4. Generate Prisma client:
   ```bash
   npx prisma generate
   ```

5. Start the server:
   ```bash
   npm run dev
   ```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user

### User
- `GET /api/user` - Get user profile (requires auth)

### Emails
- `GET /api/emails` - Get all emails for user (requires auth)
- `POST /api/emails` - Create new email (requires auth)
- `PUT /api/emails/:id` - Update email (requires auth)
- `DELETE /api/emails/:id` - Delete email (requires auth)

## Phase 2: Email Parsing

Next phase will include:
- OAuth 2.0 email authorization
- IMAP email fetching
- LLM parsing with structured output
- Database storage of parsed data