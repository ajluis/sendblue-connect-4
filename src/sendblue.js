const API_BASE = "https://api.sendblue.com";

export class SendblueClient {
  constructor({ apiKey, apiSecret, fetchImpl = fetch }) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.fetch = fetchImpl;
  }

  headers() {
    return {
      "content-type": "application/json",
      "sb-api-key-id": this.apiKey,
      "sb-api-secret-key": this.apiSecret,
    };
  }

  async request(path, { method = "GET", body, timeoutMs = 10_000 } = {}) {
    const response = await this.fetch(`${API_BASE}${path}`, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text.slice(0, 1_000) };
    }
    if (!response.ok) {
      const error = new Error(`Sendblue returned HTTP ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return { status: response.status, payload };
  }

  sendInitialAppCard(body) {
    return this.request("/api/send-message", { method: "POST", body });
  }

  async updateAppCard(originalHandle, body) {
    const path = `/api/messages/${encodeURIComponent(originalHandle)}/update-app-card`;
    const delays = [0, 200, 500, 1_000, 2_000];
    let lastError;
    for (const delay of delays) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        return await this.request(path, { method: "POST", body });
      } catch (error) {
        lastError = error;
        if (![408, 409, 429, 500, 502, 503, 504].includes(error.status)) throw error;
      }
    }
    throw lastError;
  }

  listWebhooks() {
    return this.request("/api/account/webhooks");
  }

  addWebhook(url) {
    return this.request("/api/account/webhooks", {
      method: "POST",
      body: { type: "receive", webhooks: [url] },
    });
  }
}
