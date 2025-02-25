require("dotenv").config();
const express = require("express");
const mysql = require("mysql2/promise"); // Menggunakan mysql2 dengan async/await
const cors = require("cors");

const app = express();
const port = process.env.PORT || 5002;

// Middleware
app.use(cors());
app.use(express.json());

// Koneksi ke MySQL dengan mysql2/promise
const pool = mysql.createPool({
  host: process.env.DB_HOST || "172.18.72.36",
  user: process.env.DB_USER || "admin",
  password: process.env.DB_PASS || "dmdhapp123#",
  database: process.env.DB_NAME || "dmdh_app",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Endpoint untuk mendapatkan semua user
app.get("/api/users", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM users");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Jalankan server
app.listen(port, () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
});
