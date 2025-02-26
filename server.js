require("dotenv").config();
const express = require("express");
const mysql = require("mysql2/promise"); // Gunakan mysql2 dengan async/await
const cors = require("cors");

const app = express();
const port = process.env.PORT || 3002;

// Middleware
app.use(cors());
app.use(express.json());

// Koneksi ke MySQL menggunakan mysql2/promise
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
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

// Bulk insert ke tabel Kelas
app.post("/kelas", async (req, res) => {
  try {
    const kelasArray = req.body.kelas;
    if (!Array.isArray(kelasArray) || kelasArray.length === 0) {
      return res.status(400).json({ error: "Data kelas harus berupa array dan tidak boleh kosong" });
    }

    const values = kelasArray.map((nama) => [nama]);
    const sql = "INSERT INTO kelas (nama) VALUES ?";
    const [result] = await pool.query(sql, [values]);

    res.status(201).json({ message: `${result.affectedRows} kelas berhasil ditambahkan` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk insert ke tabel Guru
app.post("/guru", async (req, res) => {
  try {
    const guruArray = req.body.guru;
    if (!Array.isArray(guruArray) || guruArray.length === 0) {
      return res.status(400).json({ error: "Data guru harus berupa array dan tidak boleh kosong" });
    }

    const values = guruArray.map((nama) => [nama]);
    const sql = "INSERT INTO guru (nama) VALUES ?";
    const [result] = await pool.query(sql, [values]);

    res.status(201).json({ message: `${result.affectedRows} guru berhasil ditambahkan` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk insert ke tabel Santri
app.post("/santri", async (req, res) => {
  try {
    const santriArray = req.body.santri;
    if (!Array.isArray(santriArray) || santriArray.length === 0) {
      return res.status(400).json({ error: "Data santri harus berupa array dan tidak boleh kosong" });
    }

    const values = santriArray.map((nama) => [nama]);
    const sql = "INSERT INTO santri (nama) VALUES ?";
    const [result] = await pool.query(sql, [values]);

    res.status(201).json({ message: `${result.affectedRows} santri berhasil ditambahkan` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk insert ke tabel Waktu
app.post("/waktu", async (req, res) => {
  try {
    const waktuArray = req.body.waktu;
    if (!Array.isArray(waktuArray) || waktuArray.length === 0) {
      return res.status(400).json({ error: "Data waktu harus berupa array dan tidak boleh kosong" });
    }

    const values = waktuArray.map((nama) => [nama]);
    const sql = "INSERT INTO waktu (nama) VALUES ?";
    const [result] = await pool.query(sql, [values]);

    res.status(201).json({ message: `${result.affectedRows} waktu berhasil ditambahkan` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk insert ke tabel Absensi
app.post("/absensi", async (req, res) => {
  try {
    const absensiArray = req.body.absensi;
    if (!Array.isArray(absensiArray) || absensiArray.length === 0) {
      return res.status(400).json({ error: "Data absensi harus berupa array dan tidak boleh kosong" });
    }

    const values = absensiArray.map(({ tanggal, guru_id, kelas_id, waktu_id, santri_id, hadir, izin, alpa, pulang, sakit }) =>
      [tanggal, guru_id, kelas_id, waktu_id, santri_id, hadir, izin, alpa, pulang, sakit]
    );

    const sql = `INSERT INTO absensi (tanggal, guru_id, kelas_id, waktu_id, santri_id, hadir, izin, alpa, pulang, sakit) VALUES ?`;
    const [result] = await pool.query(sql, [values]);

    res.status(201).json({ message: `${result.affectedRows} absensi berhasil ditambahkan` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Jalankan server
app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
});
