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

// **1️⃣ API Login**
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username dan password wajib diisi" });
  }

  try {
    // Cek apakah user ada di database
    const [userRows] = await pool.query("SELECT * FROM users WHERE username = ? AND password = ?", [username, password]);

    if (userRows.length === 0) {
      return res.status(401).json({ error: "Username atau password salah" });
    }

    const user = userRows[0]; // Dapatkan data user
    const user_id = user.id;

    // Cek apakah user ini adalah seorang guru
    const [guruRows] = await pool.query("SELECT id FROM guru WHERE user_id = ?", [user_id]);

    if (guruRows.length === 0) {
      return res.status(403).json({ error: "User ini bukan seorang guru", user , user_id });
    }

    const guru_id = guruRows[0].id;

    // Ambil jadwal_ngajar berdasarkan guru_id
    const [jadwalRows] = await pool.query(`
      SELECT 
        j.id AS jadwal_id,
        g.nama AS guru_nama,
        k.nama AS kelas_nama,
        w.nama AS waktu_nama,
      FROM jadwal_ngajar j
      JOIN guru g ON j.guru_id = g.id
      JOIN kelas k ON j.kelas_id = k.id
      JOIN waktu w ON j.waktu_id = w.id
      WHERE j.guru_id = ?
    `, [guru_id]);

    res.json({
      message: "Login berhasil",
      user: {
        id: user_id,
        username: user.username,
        guru_id: guru_id
      },
      jadwal_ngajar: jadwalRows
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// **1️⃣ API Daftar User**
app.post("/register", async (req, res) => {
  const { username, password, isGuru, namaGuru } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username dan password wajib diisi" });
  }

  try {
    // Cek apakah username sudah ada
    const [existingUsers] = await pool.query("SELECT id FROM users WHERE username = ?", [username]);

    if (existingUsers.length > 0) {
      return res.status(400).json({ error: "Username sudah digunakan" });
    }

    // Insert user baru ke tabel users
    const [userResult] = await pool.query(
      "INSERT INTO users (username, password) VALUES (?, ?)",
      [username, password]
    );

    const userId = userResult.insertId; // ID user yang baru dibuat

    // Jika user juga seorang guru, tambahkan ke tabel guru
    if (isGuru && namaGuru) {
      await pool.query("INSERT INTO guru (nama, user_id) VALUES (?, ?)", [namaGuru, userId]);
    }

    res.status(201).json({ message: "Pendaftaran berhasil", user_id: userId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/register/bulk", async (req, res) => {
  const users = req.body.users; // Expect array of users

  if (!Array.isArray(users) || users.length === 0) {
    return res.status(400).json({ error: "Data users harus berupa array dan tidak boleh kosong" });
  }

  try {
    const userValues = [];
    const guruValues = [];

    for (const user of users) {
      const { username, password, isGuru, namaGuru } = user;

      if (!username || !password) {
        return res.status(400).json({ error: "Username dan password wajib diisi untuk setiap user" });
      }

      // Simpan user ke array
      userValues.push([username, password]);

      // Jika user juga seorang guru, simpan datanya untuk nanti dimasukkan ke tabel guru
      if (isGuru && namaGuru) {
        guruValues.push(namaGuru); // Nama guru sementara disimpan dulu
      }
    }

    // Masukkan semua user ke tabel users
    const [userResults] = await pool.query(
      "INSERT INTO users (username, password) VALUES ?",
      [userValues]
    );

    const insertedUserIds = Array.from({ length: userResults.affectedRows }, (_, i) => userResults.insertId + i);

    // Jika ada guru yang harus dimasukkan
    if (guruValues.length > 0) {
      const guruInsertValues = guruValues.map((nama, i) => [nama, insertedUserIds[i]]);
      await pool.query("INSERT INTO guru (nama, user_id) VALUES ?", [guruInsertValues]);
    }

    res.status(201).json({ message: `${userResults.affectedRows} user berhasil didaftarkan` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// **2️⃣ API Reset Password**
app.post("/reset-password", async (req, res) => {
  const { username, password_lama, password_baru } = req.body;

  if (!username || !password_lama || !password_baru) {
    return res.status(400).json({ error: "Username, password lama, dan password baru wajib diisi" });
  }

  try {
    // 1️⃣ Cek apakah user ada
    const [userRows] = await pool.query("SELECT * FROM users WHERE username = ?", [username]);

    if (userRows.length === 0) {
      return res.status(404).json({ error: "User tidak ditemukan" });
    }

    const user = userRows[0];

    // 2️⃣ Cek apakah password lama sesuai
    if (user.password !== password_lama) {
      return res.status(401).json({ error: "Password lama salah" });
    }

    // 3️⃣ Update password user
    await pool.query("UPDATE users SET password = ? WHERE username = ?", [password_baru, username]);

    res.json({ message: "Password berhasil direset" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
