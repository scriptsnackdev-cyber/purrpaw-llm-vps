# Secure Standalone Vertex AI Server: `purrpaw-llm-vps`

This is a high-performance, secure Node.js/TypeScript Express server designed to run on a persistent VPS. It connects directly to Google Cloud's Vertex AI (`gemini-3.5-flash`) and queries Supabase securely on the backend, ensuring **zero sensitive data leakage** over the network.

---

## 🔒 Security Measures

1. **Supabase JWT Middleware Protection**:
   - Every request is authenticated using your application's logged-in token.
   - Requires header: `Authorization: Bearer <Supabase_JWT_Token>`
   - Even if someone gains access to your VPS URL, they cannot use the API without a valid Supabase login token.
2. **No Sensitive Payloads Over Client Request**:
   - The client only sends minimal request fields (`sessionId`, `messageText`, etc.).
   - The VPS directly queries Supabase on the backend using the Service Role Key to fetch character profiles, user personas, relationship details, and history. **Sensitive settings are never transmitted from the mobile/web client.**

---

## 🚀 Quick Setup on your VPS

### 1. Copy the Code to your VPS
Zip the `purrpaw-llm-vps` folder and upload it to your VPS. Extract it into a directory of your choice (e.g. `/var/www/purrpaw-llm-vps`).

### 2. Install Node.js
Ensure Node.js (v18 or higher) is installed on your VPS:
```bash
# Ubuntu/Debian installation example
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 3. Install Dependencies
Navigate into the extracted folder and run:
```bash
npm install
```

### 4. Configure Environment Variables
Copy `.env.example` to `.env` and fill in your keys:
```bash
cp .env.example .env
```
Open `.env` and configure:
- `PORT`: Set to `8080` (or any custom port).
- `SUPABASE_URL`: Your Supabase Project URL.
- `SUPABASE_ANON_KEY`: Your Supabase Anon Key.
- `SUPABASE_SERVICE_ROLE_KEY`: **Critical** for secure backend data fetching bypassing RLS.
- `GCP_PROJECT`: Your Google Cloud Project ID.
- `GCP_LOCATION`: Google Cloud Vertex AI location (defaults to `us-central1`).
- `GOOGLE_APPLICATION_CREDENTIALS`: Path to your Service Account credentials JSON file (e.g. `./gcp-key.json`).

### 5. Google Cloud Service Account Authentication
To let the server call Vertex AI, create a GCP Service Account with the **Vertex AI User** permission:
1. Go to GCP Console -> **IAM & Admin** -> **Service Accounts**.
2. Click **Create Service Account** and name it (e.g., `purrpaw-vertex-user`).
3. Under roles, select **Vertex AI User** (or `roles/aiplatform.user`).
4. Select the created Service Account -> **Keys** -> **Add Key** -> **Create New Key** (Select **JSON**).
5. Download the JSON key file, rename it to `gcp-key.json`, and place it in the root folder of this project (matching the `GOOGLE_APPLICATION_CREDENTIALS` path).

---

## 💻 Running the Server

### For Development
To test the API instantly with auto-reloads:
```bash
npm run dev
```

### For Production (PM2 Process Manager)
We recommend using `pm2` to keep the process running persistently in the background:
```bash
# Install PM2 globally
sudo npm install -g pm2

# Build the TypeScript project
npm run build

# Start the server persistently
pm2 start dist/server.js --name "purrpaw-llm-vps"

# Save the PM2 list and configure to launch on system reboot
pm2 save
pm2 startup
```

---

## 📡 API Endpoints

### 1. Status Check
- **GET** `/status`
- **Response**:
  ```json
  { "status": "running", "service": "purrpaw-llm-vps", "model": "gemini-3.5-flash" }
  ```

### 2. Secured Chat Call (SSE Stream)
- **POST** `/chat`
- **Headers**:
  - `Authorization: Bearer <Supabase_JWT_Token>`
  - `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "sessionId": "session-uuid-here",
    "messageText": "สวัสดีจ้า",
    "action": "chat",
    "user_heartbeat": 78
  }
  ```
- **Response**: Word-by-word Server-Sent Events (SSE) stream (`data: {"text": "...", "isStreaming": true}\n\n`) followed by a final `event: meta` SSE containing parsed XML database records.
