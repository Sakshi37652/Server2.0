const admin = require("firebase-admin");
require("dotenv").config();

function normalizePrivateKey(key) {
    if (!key) return undefined;

    // Support keys provided with escaped newlines (common in .env files).
    return key.includes("\\n") ? key.replace(/\\n/g, "\n") : key;
}

function buildServiceAccount() {
    const required = [
        "FIREBASE_PROJECT_ID",
        "FIREBASE_PRIVATE_KEY",
        "FIREBASE_CLIENT_EMAIL"
    ];

    const missing = required.filter((name) => !process.env[name]);

    if (missing.length > 0) {
        throw new Error(
            `Missing required Firebase environment variables: ${missing.join(", ")}`
        );
    }

    return {
        type: process.env.FIREBASE_TYPE,
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: process.env.FIREBASE_AUTH_URI,
        token_uri: process.env.FIREBASE_TOKEN_URI,
        auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
        client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
        universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN
    };
}

// Initialize only once, even if this module is required multiple times
// or a hot-reload runtime re-evaluates it.
if (admin.apps.length === 0) {
    admin.initializeApp({
        credential: admin.credential.cert(buildServiceAccount()),
        databaseURL: process.env.FIREBASE_DATABASE_URL
    });
}

const db = admin.database();

module.exports = {
    admin,
    db
};
