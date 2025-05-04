require("dotenv").config();
const jwt = require("jsonwebtoken");
const express = require("express");
const mysql = require("mysql2/promise"); // Gunakan mysql2 dengan async/await
const cors = require("cors");
const moment = require("moment-hijri");
const app = express();
const port = process.env.PORT || 3002;

moment.locale("id");
// Middleware
app.use(cors());
app.use(express.json());

const SECRET_KEY = process.env.JWT_SECRET || "rahasia-super-aman";
// Koneksi ke MySQL menggunakan mysql2/promise
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
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
    const [userRows] = await pool.query(
      "SELECT * FROM users WHERE username = ? AND password = ?",
      [username, password]
    );

    if (userRows.length === 0) {
      return res.status(401).json({ error: "Username atau password salah" });
    }

    const user = userRows[0];
    const user_id = user.id;
    const user_role = user.role;

    // Cek apakah user seorang guru
    const [guruRows] = await pool.query(
      "SELECT id FROM guru WHERE user_id = ?",
      [user_id]
    );

    if (guruRows.length === 0) {
      return res.status(403).json({ error: "User ini bukan seorang guru" });
    }

    const guru_id = guruRows[0].id;

    // Ambil jadwal ngajar
    const [jadwalRows] = await pool.query(
      `SELECT 
          j.id AS jadwal_id,
          j.kelas_id,
          j.guru_id,
          j.waktu_id,
          g.nama AS guru_nama,
          k.nama AS kelas_nama,
          w.nama AS waktu_nama
       FROM jadwal_ngajar j
       JOIN guru g ON j.guru_id = g.id
       JOIN kelas k ON j.kelas_id = k.id
       JOIN waktu w ON j.waktu_id = w.id
       WHERE j.guru_id = ?`,
      [guru_id]
    );

    // 🛡️ Buat token JWT
    const accessToken = jwt.sign(
      {
        user_id: user_id,
        username: user.username,
        guru_id: guru_id,
        role: user_role,
      },
      SECRET_KEY,
      { expiresIn: "2h" }
    );

    res.json({
      message: "Login berhasil",
      accessToken,
      user: {
        id: user_id,
        username: user.username,
        guru_id: guru_id,
        role: user_role,
      },
      jadwal_ngajar: jadwalRows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/change-password", async (req, res) => {
  const { username, oldPassword, newPassword } = req.body;

  if (!username || !oldPassword || !newPassword) {
    return res.status(400).json({ message: "Semua field harus diisi!" });
  }

  try {
    // Cek apakah username dan password lama cocok
    const [userRows] = await pool.query(
      "SELECT * FROM users WHERE username = ? AND password = ?",
      [username, oldPassword]
    );

    if (userRows.length === 0) {
      return res.status(400).json({ message: "Username atau password lama salah!" });
    }

    // Update password baru
    await pool.query("UPDATE users SET password = ? WHERE username = ?", [newPassword, username]);

    res.json({ message: "Password berhasil diubah!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Terjadi kesalahan server" });
  }
});

app.get("/jadwal-ngajar", async (req, res) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    return res.status(401).json({ error: "Token tidak ditemukan" });
  }

  const token = authHeader.split(" ")[1]; // "Bearer <token>"

  try {
    // Verifikasi token
    const decoded = jwt.verify(token, SECRET_KEY);

    const { user_id, username, guru_id } = decoded; // ambil data dari payload token

      // 1. Ambil nama guru dari tabel guru
      const [guruRows] = await pool.query(
        `SELECT nama FROM guru WHERE id = ?`,
        [guru_id]
      );
      const guruNama = guruRows.length > 0 ? guruRows[0].nama : null;
  
      // 2. Ambil jadwal ngajar (tanpa join ke guru)
      const [jadwalRows] = await pool.query(
        `SELECT 
            j.id AS jadwal_id,
            j.kelas_id,
            j.waktu_id,
            k.nama AS kelas_nama,
            w.nama AS waktu_nama
         FROM jadwal_ngajar j
         JOIN kelas k ON j.kelas_id = k.id
         JOIN waktu w ON j.waktu_id = w.id
         WHERE j.guru_id = ?`,
        [guru_id]
      );

    res.json({
      message: "Login berhasil", // sengaja samain
      accessToken: token, // balikin tokennya lagi (opsional)
      user: {
        id: user_id,
        username: username,
        guru_id: guru_id,
        guru_nama: guruNama, // taruh di sini
      },
      jadwal_ngajar: jadwalRows.map((j) => ({
        jadwal_id: j.jadwal_id,
        kelas_id: j.kelas_id,
        kelas_nama: j.kelas_nama,
        waktu_id: j.waktu_id,
        waktu_nama: j.waktu_nama,
      })),
    });
  } catch (error) {
    return res.status(403).json({ error: "Token tidak valid atau expired" });
  }
});

app.post("/register/bulk", async (req, res) => {
  const users = req.body.users; // Expect array of users

  if (!Array.isArray(users) || users.length === 0) {
    return res
      .status(400)
      .json({ error: "Data users harus berupa array dan tidak boleh kosong" });
  }

  try {
    const userValues = [];
    const guruValues = [];

    for (const user of users) {
      const { username, password, isGuru, namaGuru } = user;

      if (!username || !password) {
        return res.status(400).json({
          error: "Username dan password wajib diisi untuk setiap user",
        });
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

    const insertedUserIds = Array.from(
      { length: userResults.affectedRows },
      (_, i) => userResults.insertId + i
    );

    // Jika ada guru yang harus dimasukkan
    if (guruValues.length > 0) {
      const guruInsertValues = guruValues.map((nama, i) => [
        nama,
        insertedUserIds[i],
      ]);
      await pool.query("INSERT INTO guru (nama, user_id) VALUES ?", [
        guruInsertValues,
      ]);
    }

    res.status(201).json({
      message: `${userResults.affectedRows} user berhasil didaftarkan`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// **2️⃣ API Reset Password**
app.post("/reset-password", async (req, res) => {
  const { username, password_lama, password_baru } = req.body;

  if (!username || !password_lama || !password_baru) {
    return res.status(400).json({
      error: "Username, password lama, dan password baru wajib diisi",
    });
  }

  try {
    // 1️⃣ Cek apakah user ada
    const [userRows] = await pool.query(
      "SELECT * FROM users WHERE username = ?",
      [username]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ error: "User tidak ditemukan" });
    }

    const user = userRows[0];

    // 2️⃣ Cek apakah password lama sesuai
    if (user.password !== password_lama) {
      return res.status(401).json({ error: "Password lama salah" });
    }

    // 3️⃣ Update password user
    await pool.query("UPDATE users SET password = ? WHERE username = ?", [
      password_baru,
      username,
    ]);

    res.json({ message: "Password berhasil direset" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//menambahkan jadwal ngajar

app.post("/jadwal-ngajar", async (req, res) => {
  const { guru_id, kelas_id, waktu_id } = req.body;

  // Validasi input tidak boleh kosong
  if (!guru_id || !kelas_id || !waktu_id) {
    return res.status(400).json({ error: "Semua field wajib diisi!" });
  }

  try {
    // Query untuk menambahkan jadwal ngajar
    const sql = `INSERT INTO jadwal_ngajar (guru_id, kelas_id, waktu_id) VALUES (?, ?, ?)`;
    const [result] = await pool.query(sql, [guru_id, kelas_id, waktu_id]);

    res.status(201).json({
      message: "Jadwal ngajar berhasil ditambahkan!",
      jadwal_id: result.insertId, // ID dari jadwal yang baru ditambahkan
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint untuk mendapatkan data absensi berdasarkan kelas_id, tanggal, dan waktu_id
app.post("/api/absensi-harian", async (req, res) => {
  try {
    const { kelas_id, tanggal, waktu_id } = req.body;

    if (!kelas_id || !tanggal || !waktu_id) {
      return res
        .status(400)
        .json({ message: "kelas_id, tanggal, dan waktu_id diperlukan" });
    }

    // Cek apakah ada data absensi untuk tanggal, kelas, dan waktu tertentu
    const sqlAbsensi = `
      SELECT 
        absensi.santri_id, 
        santri.nama, 
        absensi.hadir, 
        absensi.izin, 
        absensi.alpa, 
        absensi.pulang, 
        absensi.sakit
      FROM absensi
      JOIN santri ON absensi.santri_id = santri.id
      WHERE absensi.kelas_id = ? 
        AND DATE(absensi.tanggal) = ? 
        AND absensi.waktu_id = ?`;

    const [absensiRows] = await pool.query(sqlAbsensi, [
      kelas_id,
      tanggal,
      waktu_id,
    ]);

    // Jika data absensi ditemukan, kirim data tersebut
    if (absensiRows.length > 0) {
      return res.json(absensiRows);
    }

    // Jika tidak ada data absensi, ambil daftar santri dari kelas tersebut
    const sqlSantri = `SELECT 
      santri.id, 
      santri.nama
      FROM santri
      WHERE kelas_id = ?`;
    const [santriRows] = await pool.query(sqlSantri, [kelas_id]);

    // Buat data absensi default (hadir = 0, izin = 0, dsb.)
    const defaultAbsensi = santriRows.map((santri) => ({
      santri_id: santri.id,
      nama: santri.nama,
      hadir: 0,
      izin: 0,
      alpa: 0,
      pulang: 0,
      sakit: 0,
    }));

    res.json(defaultAbsensi);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Terjadi kesalahan pada server" });
  }
});

// Endpoint untuk mendapatkan laporan guru
app.post("/laporan-guru", async (req, res) => {
  try {
    const { tanggal_awal, tanggal_akhir } = req.body;

    if (!tanggal_awal || !tanggal_akhir) {
      return res.status(400).json({
        message: "Tanggal awal, tanggal akhir, dan kelas_id wajib diisi.",
      });
    }

    const query = `
            SELECT 
            g.id AS guru_id,
  g.nama AS nama_guru, 
  k.nama AS nama_kelas, 
  w.nama AS waktu, 
  CASE 
    WHEN COUNT(j.id) > 0 THEN 'Guru Tetap' 
    ELSE 'Guru Pengganti' 
  END AS status,
  COUNT(DISTINCT a.tanggal) AS jumlah_ngajar
FROM absensi a
JOIN guru g ON a.guru_id = g.id
JOIN waktu w ON a.waktu_id = w.id
JOIN kelas k ON a.kelas_id = k.id
LEFT JOIN jadwal_ngajar j 
  ON a.guru_id = j.guru_id 
  AND a.kelas_id = j.kelas_id 
  AND a.waktu_id = j.waktu_id
WHERE a.tanggal BETWEEN ? AND ?
GROUP BY g.nama, k.nama, w.nama, a.guru_id
ORDER BY k.nama, w.nama, status DESC;
         `;
    const [rows] = await pool.query(query, [tanggal_awal, tanggal_akhir]);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Terjadi kesalahan pada server" });
  }
});

// Endpoint untuk mendapatkan data absensi guru
app.post("/detail-ngajar", async (req, res) => {
  const { tgl_awal, tgl_akhir, guru_id } = req.body;

  if (!tgl_awal || !tgl_akhir || !guru_id) {
    return res.status(400).json({
      error: "Parameter tgl_awal, tgl_akhir, dan guru_id wajib diisi",
    });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT 
g.nama AS nama,
k.nama AS kelas,
        w.nama AS waktu, 
        CASE 
            WHEN COUNT(j.id) > 0 THEN 'Guru Tetap' 
            ELSE 'Guru Pengganti' 
        END AS status,
        COUNT(DISTINCT a.tanggal) AS jumlah_ngajar,
        CASE 
            WHEN COUNT(j.id) > 0 THEN COALESCE(MAX(aktif_belajar.total_aktif), 0)
            ELSE NULL
        END AS jumlah_aktif_belajar
      FROM absensi a
JOIN guru g ON a.guru_id = g.id
      JOIN kelas k ON a.kelas_id = k.id
      JOIN waktu w ON a.waktu_id = w.id
      LEFT JOIN jadwal_ngajar j 
          ON a.guru_id = j.guru_id 
          AND a.kelas_id = j.kelas_id 
          AND a.waktu_id = j.waktu_id
      LEFT JOIN (
          SELECT 
              a2.kelas_id, 
              a2.waktu_id, 
              COUNT(DISTINCT a2.tanggal) AS total_aktif
          FROM absensi a2
          WHERE a2.tanggal BETWEEN ? AND ?
          GROUP BY a2.kelas_id, a2.waktu_id
      ) AS aktif_belajar 
      ON a.kelas_id = aktif_belajar.kelas_id 
      AND a.waktu_id = aktif_belajar.waktu_id
      WHERE a.tanggal BETWEEN ? AND ?
      AND a.guru_id = ? 
      GROUP BY g.nama, k.nama, w.nama, a.kelas_id, a.waktu_id, a.guru_id
      ORDER BY k.nama, w.nama, status DESC;`,
      [tgl_awal, tgl_akhir, tgl_awal, tgl_akhir, guru_id]
    );

    res.json(rows);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Terjadi kesalahan pada server" });
  }
});

app.post("/absensi/alpa", async (req, res) => {
  const { tanggal } = req.body;
  if (!tanggal) {
    return res
      .status(400)
      .json({ error: "Tanggal diperlukan dalam body request" });
  }

  const query = `
      SELECT santri.nama AS santri_nama, 
             kelas.nama AS kelas_nama, 
             waktu.nama AS waktu_nama 
      FROM absensi 
      JOIN santri ON absensi.santri_id = santri.id 
      JOIN kelas ON absensi.kelas_id = kelas.id 
      JOIN waktu ON absensi.waktu_id = waktu.id 
      WHERE absensi.alpa = 1 AND absensi.tanggal = ?`;

  try {
    const [results] = await pool.query(query, [tanggal]);
    res.json(results);
  } catch (err) {
    console.error("Error executing query:", err);
    res.status(500).json({ error: "Database query error" });
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
      return res.status(400).json({
        error: "Data kelas harus berupa array dan tidak boleh kosong",
      });
    }

    const values = kelasArray.map((nama) => [nama]);
    const sql = "INSERT INTO kelas (nama) VALUES ?";
    const [result] = await pool.query(sql, [values]);

    res
      .status(201)
      .json({ message: `${result.affectedRows} kelas berhasil ditambahkan` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/kelas", async (req, res) => {
  try {
    const sql = "SELECT * FROM kelas";
    const [rows] = await pool.query(sql);

    res.status(200).json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk insert ke tabel Guru
// app.post("/guru", async (req, res) => {
//   try {
//     const guruArray = req.body.guru;
//     if (!Array.isArray(guruArray) || guruArray.length === 0) {
//       return res
//         .status(400)
//         .json({ error: "Data guru harus berupa array dan tidak boleh kosong" });
//     }

//     const values = guruArray.map((nama) => [nama]);
//     const sql = "INSERT INTO guru (nama) VALUES ?";
//     const [result] = await pool.query(sql, [values]);

//     res
//       .status(201)
//       .json({ message: `${result.affectedRows} guru berhasil ditambahkan` });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

app.get("/santri", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.id, s.nama, s.kelas_id, k.nama AS kelas_nama, s.status 
      FROM santri s
      JOIN kelas k ON s.kelas_id = k.id
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/santri", async (req, res) => {
  try {
    const { nama, kelas_id, status } = req.body;

    if (!nama || !kelas_id || !status) {
      return res.status(400).json({ error: "Nama dan kelas_id dan status wajib diisi" });
    }

    const sql = "INSERT INTO santri (nama, kelas_id, status) VALUES (?, ?, ?)";
    const [result] = await pool.query(sql, [nama, kelas_id, status]);

    res
      .status(201)
      .json({ message: "Santri berhasil ditambahkan", id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/santri", async (req, res) => {
  try {
    const { nama, kelas_id, status,id } = req.body;

    // Validasi
    if (!nama || !kelas_id || status === undefined) {
      return res
        .status(400)
        .json({ error: "Nama, kelas_id, dan status wajib diisi" });
    }

    const sql = "UPDATE santri SET nama = ?, kelas_id = ?, status = ? WHERE id = ?";
    const [result] = await pool.query(sql, [nama, kelas_id, status, id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Santri tidak ditemukan" });
    }

    res.json({ message: "Santri berhasil diupdate" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.delete("/santri/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const sql = "DELETE FROM santri WHERE id = ?";
    const [result] = await pool.query(sql, [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Santri tidak ditemukan" });
    }

    res.json({ message: "Santri berhasil dihapus" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/guru", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT g.id, g.nama, g.user_id, g.status, u.username, u.role
      FROM guru g
      JOIN users u ON g.user_id = u.id
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/guru", async (req, res) => {
  try {
    const { nama, username, guru_id, role, status } = req.body;

    if (!nama || !username || !guru_id) {
      return res.status(400).json({ error: "Nama, username, dan guru_id wajib diisi" });
    }

    const sql = `
      UPDATE guru g 
      JOIN users u ON g.user_id = u.id 
      SET g.nama = ?, u.username = ?, u.role = ?, g.status = ? 
      WHERE g.id = ?
    `;

    const [result] = await pool.query(sql, [nama, username, role, status, guru_id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Guru tidak ditemukan" });
    }

    res.json({ message: "Guru berhasil diperbarui" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/guru/add", async (req, res) => {
  try {
    const { nama, username, password, role } = req.body;

    if (!nama || !username || !password || !role) {
      return res.status(400).json({ error: "Semua field wajib diisi" });
    }

    // Insert ke tabel users
    const sqlUser = "INSERT INTO users (username, password, role) VALUES (?, ?, ?)";
    const [resultUser] = await pool.query(sqlUser, [username, password, role]);

    const userId = resultUser.insertId;

    // Insert ke tabel guru
    const sqlGuru = "INSERT INTO guru (nama, user_id) VALUES (?, ?)";
    await pool.query(sqlGuru, [nama, userId]);

    res.status(201).json({
      message: "Guru berhasil ditambahkan",
      userId: userId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/guru/delete", async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return res.status(400).json({ error: "ID guru wajib disediakan" });
    }

    const sql = "DELETE FROM guru WHERE id = ?";
    const [result] = await pool.query(sql, [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Guru tidak ditemukan" });
    }

    res.json({ message: "Guru berhasil dihapus" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// app.put("/guru/:id", async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { nama, user_id } = req.body;

//     if (!nama || !user_id) {
//       return res.status(400).json({ error: "Nama dan user_id wajib diisi" });
//     }

//     const sql = "UPDATE guru SET nama = ?, user_id = ? WHERE id = ?";
//     const [result] = await pool.query(sql, [nama, user_id, id]);

//     if (result.affectedRows === 0) {
//       return res.status(404).json({ error: "Guru tidak ditemukan" });
//     }

//     res.json({ message: "Guru berhasil diperbarui" });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// app.delete("/guru/:id", async (req, res) => {
//   try {
//     const { id } = req.params;

//     const sql = "DELETE FROM guru WHERE id = ?";
//     const [result] = await pool.query(sql, [id]);

//     if (result.affectedRows === 0) {
//       return res.status(404).json({ error: "Guru tidak ditemukan" });
//     }

//     res.json({ message: "Guru berhasil dihapus" });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// GET - Ambil Semua Data Jadwal
app.get("/jadwal-ngajar-all", async (req, res) => {
  try {
    const sql = `
      SELECT 
        j.id AS jadwal_id,
        j.kelas_id,
        j.guru_id,
        j.waktu_id,
        g.nama AS guru_nama,
        k.nama AS kelas_nama,
        w.nama AS waktu_nama
      FROM jadwal_ngajar j
      JOIN guru g ON j.guru_id = g.id
      JOIN kelas k ON j.kelas_id = k.id
      JOIN waktu w ON j.waktu_id = w.id
    `;
    const [rows] = await pool.query(sql);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST - Tambah Data Jadwal
app.post("/jadwal-ngajar", async (req, res) => {
  try {
    const { kelas_id, guru_id, waktu_id } = req.body;

    if (!kelas_id || !guru_id || !waktu_id) {
      return res.status(400).json({ error: "Semua field harus diisi" });
    }

    const sql =
      "INSERT INTO jadwal_ngajar (kelas_id, guru_id, waktu_id) VALUES (?, ?, ?)";
    const [result] = await pool.query(sql, [kelas_id, guru_id, waktu_id]);

    res.status(201).json({
      message: "Jadwal berhasil ditambahkan",
      jadwal_id: result.insertId,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/jadwal-ngajar/update", async (req, res) => {
  try {
    const { kelas_id, guru_id, waktu_id, id } = req.body;

    if (!kelas_id || !guru_id || !waktu_id || !id) {
      return res.status(400).json({ error: "Semua field harus diisi" });
    }

    const sql =
      "UPDATE jadwal_ngajar SET kelas_id = ?, guru_id = ?, waktu_id = ? WHERE id = ?";
    const [result] = await pool.query(sql, [kelas_id, guru_id, waktu_id, id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Jadwal tidak ditemukan atau tidak ada perubahan" });
    }

    res.status(200).json({
      message: "Jadwal berhasil diperbarui",
    });
  } catch (err) {
    res.status(500).json({ error: "Terjadi kesalahan pada server: " + err.message });
  }
});



// DELETE - Hapus Data Jadwal
app.delete("/jadwal-ngajar/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const sql = "DELETE FROM jadwal_ngajar WHERE id = ?";
    const [result] = await pool.query(sql, [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Jadwal tidak ditemukan" });
    }

    res.json({ message: "Jadwal berhasil dihapus" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk insert ke tabel Santri
app.post("/santri", async (req, res) => {
  try {
    const santriArray = req.body.santri;
    if (!Array.isArray(santriArray) || santriArray.length === 0) {
      return res.status(400).json({
        error: "Data santri harus berupa array dan tidak boleh kosong",
      });
    }

    const values = santriArray.map((nama) => [nama]);
    const sql = "INSERT INTO santri (nama) VALUES ?";
    const [result] = await pool.query(sql, [values]);

    res
      .status(201)
      .json({ message: `${result.affectedRows} santri berhasil ditambahkan` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk insert ke tabel Waktu
app.post("/waktu", async (req, res) => {
  try {
    const waktuArray = req.body.waktu;
    if (!Array.isArray(waktuArray) || waktuArray.length === 0) {
      return res.status(400).json({
        error: "Data waktu harus berupa array dan tidak boleh kosong",
      });
    }

    const values = waktuArray.map((nama) => [nama]);
    const sql = "INSERT INTO waktu (nama) VALUES ?";
    const [result] = await pool.query(sql, [values]);

    res
      .status(201)
      .json({ message: `${result.affectedRows} waktu berhasil ditambahkan` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/waktu", async (req, res) => {
  try {
    const sql = "SELECT * FROM waktu";
    const [rows] = await pool.query(sql);

    res.status(200).json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ INSERT DATA ABSENSI (Mencegah Duplikasi)
app.post("/absensi", async (req, res) => {
  try {
    const absensiArray = req.body.absensi;

    if (!Array.isArray(absensiArray) || absensiArray.length === 0) {
      return res.status(400).json({
        error: "Data absensi harus berupa array dan tidak boleh kosong",
      });
    }

    for (const {
      tanggal,
      guru_id,
      kelas_id,
      waktu_id,
      santri_id,
      hadir,
      izin,
      alpa,
      pulang,
      sakit,
    } of absensiArray) {
      // Cek apakah data sudah ada
      const checkSql = `SELECT COUNT(*) AS count FROM absensi WHERE tanggal = ? AND guru_id = ? AND kelas_id = ? AND waktu_id = ? AND santri_id = ?`;
      const [checkResult] = await pool.query(checkSql, [
        tanggal,
        guru_id,
        kelas_id,
        waktu_id,
        santri_id,
      ]);

      if (checkResult[0].count > 0) {
        return res
          .status(409)
          .json({ error: "Data absensi sudah ada, tidak boleh duplikat" });
      }

      // Insert data jika belum ada
      const insertSql = `INSERT INTO absensi (tanggal, guru_id, kelas_id, waktu_id, santri_id, hadir, izin, alpa, pulang, sakit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      await pool.query(insertSql, [
        tanggal,
        guru_id,
        kelas_id,
        waktu_id,
        santri_id,
        hadir,
        izin,
        alpa,
        pulang,
        sakit,
      ]);
    }

    res
      .status(201)
      .json({ message: "Absensi berhasil ditambahkan tanpa duplikasi" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ UPDATE STATUS ABSENSI
app.put("/absensi", async (req, res) => {
  try {
    const absensiArray = req.body.absensi;

    if (!Array.isArray(absensiArray) || absensiArray.length === 0) {
      return res.status(400).json({
        error: "Data absensi harus berupa array dan tidak boleh kosong",
      });
    }

    let updatedCount = 0;
    let notFoundCount = 0;

    for (const {
      tanggal,
      guru_id,
      kelas_id,
      waktu_id,
      santri_id,
      hadir,
      izin,
      alpa,
      pulang,
      sakit,
    } of absensiArray) {
      // Periksa apakah data absensi sudah ada
      const checkSql = `SELECT hadir, izin, alpa, pulang, sakit FROM absensi WHERE tanggal = ? AND guru_id = ? AND kelas_id = ? AND waktu_id = ? AND santri_id = ?`;
      const [currentStatus] = await pool.query(checkSql, [
        tanggal,
        guru_id,
        kelas_id,
        waktu_id,
        santri_id,
      ]);

      if (currentStatus.length === 0) {
        notFoundCount++;
        continue; // Jika tidak ditemukan, lanjutkan ke data berikutnya
      }

      const {
        hadir: h,
        izin: i,
        alpa: a,
        pulang: p,
        sakit: s,
      } = currentStatus[0];
      if (
        h === hadir &&
        i === izin &&
        a === alpa &&
        p === pulang &&
        s === sakit
      ) {
        continue; // Jika tidak ada perubahan, lewati update
      }

      // Update data absensi
      const updateSql = `
        UPDATE absensi 
        SET hadir = ?, izin = ?, alpa = ?, pulang = ?, sakit = ? 
        WHERE tanggal = ? AND guru_id = ? AND kelas_id = ? AND waktu_id = ? AND santri_id = ?
      `;
      const [updateResult] = await pool.query(updateSql, [
        hadir,
        izin,
        alpa,
        pulang,
        sakit,
        tanggal,
        guru_id,
        kelas_id,
        waktu_id,
        santri_id,
      ]);

      if (updateResult.affectedRows > 0) {
        updatedCount++;
      }
    }

    if (updatedCount === 0 && notFoundCount === absensiArray.length) {
      return res
        .status(404)
        .json({ error: "Semua data absensi tidak ditemukan" });
    }

    res
      .status(200)
      .json({ message: `${updatedCount} data absensi berhasil diperbarui` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Absensi Bulanan
app.post("/absensi/bulanan", async (req, res) => {
  const { startDate, endDate, kelas_id, waktu_id } = req.body;

  if (!startDate || !endDate || !kelas_id || !waktu_id) {
    return res.status(400).json({ message: "Parameter tidak lengkap" });
  }

  const query = `
      SELECT a.*, s.nama AS nama_santri, DATE_FORMAT(a.tanggal, '%Y-%m-%d') AS tanggal_format
      FROM absensi a
      JOIN santri s ON a.santri_id = s.id
      WHERE a.tanggal BETWEEN ? AND ?
      AND a.kelas_id = ?
      AND a.waktu_id = ?
      ORDER BY a.tanggal, s.nama
  `;

  try {
    const [rows] = await pool.query(query, [
      startDate,
      endDate,
      kelas_id,
      waktu_id,
    ]);

    console.log("[DEBUG] Data absensi terambil:", rows.length, "records");

    // Generate the full date range
    const tanggalList = generateTanggalRange(startDate, endDate);
    console.log("[DEBUG] Tanggal range:", tanggalList);

    const rekap = {};

    // Initialize rekap with all students and all dates set to "-"
    rows.forEach((row) => {
      const nama = row.nama_santri;

      if (!rekap[nama]) {
        rekap[nama] = {
          nama,
          tanggal: {},
          jumlah: { H: 0, S: 0, P: 0, I: 0, A: 0 },
        };

        // Initialize all dates with "-"
        tanggalList.forEach((tgl) => {
          rekap[nama].tanggal[tgl] = "-";
        });
      }
    });

    // Now fill in actual attendance data
    rows.forEach((row) => {
      const tanggal = row.tanggal_format;
      const nama = row.nama_santri;

      // Determine attendance status code
      let kode = "-";
      if (row.hadir) kode = "H";
      else if (row.izin) kode = "I";
      else if (row.sakit) kode = "S";
      else if (row.pulang) kode = "P";
      else if (row.alpa) kode = "A";

      // Set attendance for this date
      rekap[nama].tanggal[tanggal] = kode;

      // Update count for this status
      if (kode !== "-") {
        rekap[nama].jumlah[kode]++;
      }
    });

    // Convert to final result array with all dates in the range
    const finalResult = Object.values(rekap).map((santri) => {
      const result = {
        nama: santri.nama,
        ...tanggalList.reduce((acc, tgl) => {
          acc[tgl] = santri.tanggal[tgl]; // Will be "-" if no attendance data
          return acc;
        }, {}),
        jumlah_h: santri.jumlah.H,
        jumlah_s: santri.jumlah.S,
        jumlah_p: santri.jumlah.P,
        jumlah_i: santri.jumlah.I,
        jumlah_a: santri.jumlah.A,
      };

      return result;
    });

    res.json(finalResult);
  } catch (err) {
    console.error("[ERROR] Gagal query absensi:", err);
    res.status(500).json({
      message: "Gagal mengambil data absensi",
      error: err.message,
    });
  }
});

app.post("/absensi/bulanan/rekap", async (req, res) => {
  const { startDate, endDate, kelas_id } = req.body;

  if (!startDate || !endDate || !kelas_id) {
    return res.status(400).json({ message: "Parameter tidak lengkap" });
  }

  const query = `
      SELECT a.*, s.nama AS nama_santri, w.nama AS nama_waktu
      FROM absensi a
      JOIN santri s ON a.santri_id = s.id
      JOIN waktu w ON a.waktu_id = w.id
      WHERE a.tanggal BETWEEN ? AND ?
      AND a.kelas_id = ?
      ORDER BY s.nama, w.nama
  `;

  try {
    const [rows] = await pool.query(query, [startDate, endDate, kelas_id]);

    if (rows.length === 0) {
      return res.json({
        message: "Tidak ada data absensi untuk periode dan kelas ini",
        data: [],
      });
    }

    const rekap = {};

    rows.forEach((row) => {
      const nama = row.nama_santri;
      const namaWaktu = row.nama_waktu.trim().toLowerCase();

      if (!rekap[nama]) {
        rekap[nama] = {
          nama,
          total: [0, 0, 0, 0, 0],
        };
      }

      if (!rekap[nama][namaWaktu]) {
        rekap[nama][namaWaktu] = [0, 0, 0, 0, 0];
      }

      if (row.sakit) {
        rekap[nama][namaWaktu][0]++;
        rekap[nama].total[0]++;
      } else if (row.pulang) {
        rekap[nama][namaWaktu][1]++;
        rekap[nama].total[1]++;
      } else if (row.alpa) {
        rekap[nama][namaWaktu][2]++;
        rekap[nama].total[2]++;
      } else if (row.izin) {
        rekap[nama][namaWaktu][3]++;
        rekap[nama].total[3]++;
      } else if (row.hadir) {
        rekap[nama][namaWaktu][4]++;
        rekap[nama].total[4]++;
      }
    });

    const result = Object.values(rekap).map((santri, index) => ({
      no: index + 1,
      nama: santri.nama,
      malam: santri.malam || [0, 0, 0, 0, 0],
      subuh: santri.subuh || [0, 0, 0, 0, 0],
      dhuha: santri.dhuha || [0, 0, 0, 0, 0],
      zuhur: santri.zuhur || [0, 0, 0, 0, 0],
      ashar: santri.ashar || [0, 0, 0, 0, 0],
      maghrib: santri.maghrib || [0, 0, 0, 0, 0],
      isya: santri.isya || [0, 0, 0, 0, 0],
      total: santri.total,
    }));

    res.json({ message: "Berhasil mengambil data absensi", data: result });
  } catch (err) {
    console.error("[ERROR] Gagal query absensi:", err, {
      query,
      params: [startDate, endDate, kelas_id],
    });

    res.status(500).json({
      message: "Gagal mengambil data absensi",
      error: err.message,
    });
  }
});

function generateTanggalRange(start, end) {
  const result = [];
  let current = new Date(start);
  const last = new Date(end);

  while (current <= last) {
    result.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return result;
}

// app.post("/absensi/bulanan/rekapcawu", async (req, res) => {
//   const { startDate, endDate, kelas_id } = req.body;

//   if (!startDate || !endDate || !kelas_id) {
//       return res.status(400).json({ message: "Parameter tidak lengkap" });
//   }

//   const query = `
//       SELECT a.*, s.nama AS nama_santri, w.nama AS nama_waktu, MONTH(a.tanggal) AS bulan
//       FROM absensi a
//       JOIN santri s ON a.santri_id = s.id
//       JOIN waktu w ON a.waktu_id = w.id
//       WHERE a.tanggal BETWEEN ? AND ?
//       AND a.kelas_id = ?
//       ORDER BY s.nama, a.tanggal, w.nama
//   `;

//   try {
//       const [rows] = await pool.query(query, [startDate, endDate, kelas_id]);

//       if (rows.length === 0) {
//           return res.json({ message: "Tidak ada data absensi untuk periode dan kelas ini", data: [] });
//       }

//       // Mapping nomor bulan ke nama bulan hijriah yang aman
//       const bulanHijriahMap = {
//           1: "muharram",
//           2: "safar",
//           3: "rabiul_awwal",
//           4: "rabiul_akhir",
//           5: "jumadal_ula",
//           6: "jumadal_akhirah",
//           7: "rajab",
//           8: "syaban",
//           9: "ramadhan",
//           10: "syawwal",
//           11: "dzulqadah",
//           12: "dzulhijjah"
//       };

//       const rekap = {};

//       rows.forEach((row) => {
//           const nama = row.nama_santri;
//           const bulanKey = bulanHijriahMap[row.bulan];  // Konversi bulan ke nama hijriah aman
//           const namaWaktu = row.nama_waktu.trim().toLowerCase();

//           if (!rekap[nama]) {
//               rekap[nama] = {
//                   nama,
//                   muharram: [0, 0, 0, 0, 0],
//                   safar: [0, 0, 0, 0, 0],
//                   rabiul_awwal: [0, 0, 0, 0, 0],
//                   rabiul_akhir: [0, 0, 0, 0, 0],
//                   jumadal_ula: [0, 0, 0, 0, 0],
//                   jumadal_akhirah: [0, 0, 0, 0, 0],
//                   rajab: [0, 0, 0, 0, 0],
//                   syaban: [0, 0, 0, 0, 0],
//                   ramadhan: [0, 0, 0, 0, 0],
//                   syawwal: [0, 0, 0, 0, 0],
//                   dzulqadah: [0, 0, 0, 0, 0],
//                   dzulhijjah: [0, 0, 0, 0, 0],
//                   total: [0, 0, 0, 0, 0]
//               };
//           }

//           if (!rekap[nama][bulanKey]) {
//               rekap[nama][bulanKey] = [0, 0, 0, 0, 0];
//           }

//           if (row.sakit) {
//               rekap[nama][bulanKey][0]++;
//               rekap[nama].total[0]++;
//           } else if (row.pulang) {
//               rekap[nama][bulanKey][1]++;
//               rekap[nama].total[1]++;
//           } else if (row.alpa) {
//               rekap[nama][bulanKey][2]++;
//               rekap[nama].total[2]++;
//           } else if (row.izin) {
//               rekap[nama][bulanKey][3]++;
//               rekap[nama].total[3]++;
//           } else if (row.hadir) {
//               rekap[nama][bulanKey][4]++;
//               rekap[nama].total[4]++;
//           }
//       });

//       const result = Object.values(rekap).map((santri, index) => {
//           const totalHadir = santri.total[4];
//           const totalSemua = santri.total.reduce((sum, val) => sum + val, 0);

//           const persenHadir = totalSemua > 0 ? ((totalHadir / totalSemua) * 100).toFixed(2) + " %" : "0 %";
//           const persenTidakHadir = totalSemua > 0 ? ((totalSemua - totalHadir) / totalSemua * 100).toFixed(2) + " %" : "0 %";

//           return {
//               no: index + 1,
//               nama: santri.nama,
//               muharram: santri.muharram,
//               safar: santri.safar,
//               rabiul_awwal: santri.rabiul_awwal,
//               rabiul_akhir: santri.rabiul_akhir,
//               jumadal_ula: santri.jumadal_ula,
//               jumadal_akhirah: santri.jumadal_akhirah,
//               rajab: santri.rajab,
//               syaban: santri.syaban,
//               ramadhan: santri.ramadhan,
//               syawwal: santri.syawwal,
//               dzulqadah: santri.dzulqadah,
//               dzulhijjah: santri.dzulhijjah,
//               total: [persenHadir, persenTidakHadir]
//           };
//       });

//       res.json({ message: "Berhasil mengambil data absensi", data: result });
//   } catch (err) {
//       console.error("[ERROR] Gagal query absensi:", err, {
//           query,
//           params: [startDate, endDate, kelas_id]
//       });

//       res.status(500).json({
//           message: "Gagal mengambil data absensi",
//           error: err.message,
//       });
//   }
// });

app.post("/bulanan/rekapcawu", async (req, res) => {
  try {
    const { startDate, endDate, kelas_id } = req.body;

    // Validate input
    if (!startDate || !endDate || !kelas_id) {
      return res.status(400).json({ message: "Parameter tidak lengkap" });
    }

    // Improved query with parameterized input and more efficient grouping
    const query = `
          SELECT 
              santri.nama,
              MONTH(tanggal) as bulan,
              SUM(CASE WHEN status = 'hadir' THEN 1 ELSE 0 END) AS hadir,
              SUM(CASE WHEN status = 'izin' THEN 1 ELSE 0 END) AS izin,
              SUM(CASE WHEN status = 'alpa' THEN 1 ELSE 0 END) AS alpa,
              SUM(CASE WHEN status = 'pulang' THEN 1 ELSE 0 END) AS pulang,
              SUM(CASE WHEN status = 'sakit' THEN 1 ELSE 0 END) AS sakit
          FROM absensi
          JOIN santri ON santri.id = absensi.santri_id
          WHERE tanggal BETWEEN ? AND ?
          AND kelas_id = ?
          GROUP BY santri.nama, MONTH(tanggal)
          ORDER BY santri.nama, bulan
      `;

    const [rows] = await db.query(query, [startDate, endDate, kelas_id]);

    // Improved data processing function
    const hasil = prosesDataRekap(rows);

    res.json({ data: hasil });
  } catch (error) {
    console.error("Error dalam endpoint rekapcawu:", error);
    res.status(500).json({
      message: "Gagal mengambil data",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

function prosesDataRekap(rows) {
  const hijriMonthMap = {
    1: "muharam",
    2: "safar",
    3: "rabiulawal",
    4: "rabiulakhir",
    5: "jumadilawal",
    6: "jumadilakhir",
    7: "rajab",
    8: "syaaban",
    9: "ramadhan",
    10: "syawal",
    11: "dzulqadah",
    12: "dzulhijjah",
  };

  // Use Map for more efficient data storage
  const mapSantri = new Map();

  rows.forEach((row) => {
    // Ensure the santri entry exists
    if (!mapSantri.has(row.nama)) {
      mapSantri.set(row.nama, {
        nama: row.nama,
        muharam: [0, 0, 0, 0, 0],
        safar: [0, 0, 0, 0, 0],
        rabiulawal: [0, 0, 0, 0, 0],
        rabiulakhir: [0, 0, 0, 0, 0],
        jumadilawal: [0, 0, 0, 0, 0],
        jumadilakhir: [0, 0, 0, 0, 0],
        rajab: [0, 0, 0, 0, 0],
        syaaban: [0, 0, 0, 0, 0],
        ramadhan: [0, 0, 0, 0, 0],
        syawal: [0, 0, 0, 0, 0],
        dzulqadah: [0, 0, 0, 0, 0],
        dzulhijjah: [0, 0, 0, 0, 0],
        total: [0, 0],
      });
    }

    const santriData = mapSantri.get(row.nama);
    const bulanKey = hijriMonthMap[row.bulan];

    if (bulanKey) {
      // Order: Sakit, Pulang, Alpa, Izin, Hadir
      santriData[bulanKey] = [
        row.sakit,
        row.pulang,
        row.alpa,
        row.izin,
        row.hadir,
      ];

      // Update total counts
      santriData.total[0] += row.hadir;
      santriData.total[1] += row.izin + row.alpa + row.sakit;
    }
  });

  // Convert Map to array with index
  return Array.from(mapSantri.values()).map((data, index) => ({
    no: index + 1,
    ...data,
  }));
}

app.post("/absensi/bulanan/semuawaktu", async (req, res) => {
  const { startDate, endDate, kelas_id } = req.body;

  if (!startDate || !endDate || !kelas_id) {
    return res
      .status(400)
      .json({ message: "startDate, endDate, kelas_id wajib diisi" });
  }

  try {
    // Query ambil rekap absensi + nama waktu langsung
    const [rows] = await pool.query(
      ` 
          SELECT  
              a.waktu_id,  
              w.nama AS nama_waktu, 
              a.santri_id,  
              s.nama AS nama_santri, 
              SUM(a.hadir) AS total_hadir, 
              SUM(a.sakit) AS total_sakit, 
              SUM(a.pulang) AS total_pulang, 
              SUM(a.alpa) AS total_alpa, 
              SUM(a.izin) AS total_izin 
          FROM absensi a 
          JOIN santri s ON a.santri_id = s.id 
          JOIN waktu w ON a.waktu_id = w.id 
          WHERE  
              a.tanggal BETWEEN ? AND ? 
              AND a.kelas_id = ? 
          GROUP BY  
              a.waktu_id, w.nama, a.santri_id, s.nama 
      `,
      [startDate, endDate, kelas_id]
    );

    // Hitung jumlah aktif belajar (jumlah hari antara startDate & endDate sesuai tgl yang ada di database)
    const [activeStudyDays] = await pool.query(
      `
      SELECT
          a.waktu_id,
          COUNT(DISTINCT a.tanggal) AS jumlah_hari
      FROM 
          absensi a
      WHERE 
          a.tanggal BETWEEN ? AND ?
          AND a.kelas_id = ?
      GROUP BY 
          a.waktu_id
      `,
      [startDate, endDate, kelas_id]
    );

    // Create a mapping of waktu_id to jumlah_hari
    const activeStudyDaysMap = {};
    activeStudyDays.forEach((day) => {
      activeStudyDaysMap[day.waktu_id] = day.jumlah_hari;
    });

    // Proses hasil query jadi format yang diminta
    const result = {};

    rows.forEach((row) => {
      if (!result[row.nama_waktu]) {
        result[row.nama_waktu] = {
          jumlah_aktif_belajar: activeStudyDaysMap[row.waktu_id] || 0,
          rekap_bulanan: [],
        };
      }

      result[row.nama_waktu].rekap_bulanan.push({
        nama: row.nama_santri,
        jumlah_h: row.total_hadir,
        jumlah_s: row.total_sakit,
        jumlah_p: row.total_pulang,
        jumlah_i: row.total_izin,
        jumlah_a: row.total_alpa,
      });
    });

    res.json(result);
  } catch (error) {
    console.error("Error saat mengambil data absensi bulanan:", error);
    res
      .status(500)
      .json({ message: "Terjadi kesalahan server", error: error.message });
  }
});

app.post("/rekapcawu", async (req, res) => {
  const { startDate, endDate, kelas_id } = req.body;

  try {
    const hijriMonths = [];
    let current = moment(startDate, "YYYY-MM-DD");

    while (current.isBefore(endDate) || current.isSame(endDate)) {
      const monthName = current.format("iMMMM");
      const monthNumber = current.iMonth() + 1;
      const year = current.iYear();

      // Konversi bulan Hijriah ke range Masehi
      const hijriStart = moment(`${year}-${monthNumber}-1`, "iYYYY-iM-iD");
      const hijriEnd = hijriStart.clone().endOf("iMonth");

      hijriMonths.push({
        monthName,
        hijriStart,
        hijriEnd,
        startDate: hijriStart.format("YYYY-MM-DD"),
        endDate: hijriEnd.format("YYYY-MM-DD"),
      });

      current = hijriEnd.clone().add(1, "day"); // loncat ke awal bulan Hijriah berikutnya
    }

    console.log("Hijri Months Mapping:", hijriMonths); // Debugging

    const results = [];

    for (const month of hijriMonths) {
      console.log(
        `Querying for month: ${month.monthName}, Range: ${month.startDate} - ${month.endDate}`
      );

      const [rows] = await pool.query(
        `
              SELECT 
                  a.santri_id,
                  s.nama AS nama_santri,
                  SUM(a.hadir) AS hadir,
                  SUM(a.sakit) AS sakit,
                  SUM(a.pulang) AS pulang,
                  SUM(a.alpa) AS alpa,
                  SUM(a.izin) AS izin
              FROM absensi a
              JOIN santri s ON a.santri_id = s.id
              WHERE a.tanggal BETWEEN ? AND ?
              AND a.kelas_id = ?
              GROUP BY a.santri_id, s.nama
          `,
        [month.startDate, month.endDate, kelas_id]
      );

      rows.forEach((row) => {
        const existing = results.find((r) => r.santri_id === row.santri_id);

        if (!existing) {
          results.push({
            santri_id: row.santri_id,
            nama: row.nama_santri,
            [month.monthName.toLowerCase()]: [
              row.hadir,
              row.sakit,
              row.pulang,
              row.alpa,
              row.izin,
            ],
            total: [0, 0], // nanti hitung total
          });
        } else {
          existing[month.monthName.toLowerCase()] = [
            row.hadir,
            row.sakit,
            row.pulang,
            row.alpa,
            row.izin,
          ];
        }
      });
    }

    // Hitung total hadir dan tidak hadir
    results.forEach((row) => {
      let totalHadir = 0;
      let totalTakHadir = 0;

      hijriMonths.forEach(({ monthName }) => {
        const key = monthName.toLowerCase();
        if (row[key]) {
          totalHadir += row[key][0]; // hadir
          totalTakHadir +=
            row[key][1] + row[key][2] + row[key][3] + row[key][4]; // sakit, pulang, alpa, izin
        } else {
          row[key] = [0, 0, 0, 0, 0]; // default 0 jika tidak ada data
        }
      });

      row.total = [totalHadir, totalTakHadir];
    });

    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({
      success: false,
      message: "Terjadi kesalahan saat mengambil data",
      error: error.message,
    });
  }
});

const hijriMonths = {
  1: "Muharram",
  2: "Safar",
  3: "Rabiul Awal",
  4: "Rabiul Akhir",
  5: "Jumadil Awal",
  6: "Jumadil Akhir",
  7: "Rajab",
  8: "Sya'ban",
  9: "Ramadhan",
  10: "Syawal",
  11: "Dzulqa'dah",
  12: "Dzulhijjah",
};

app.post("/rekapcawuv2", async (req, res) => {
  const { startDate, endDate, kelas_id } = req.body;

  try {
    const startHijri = moment(startDate, "YYYY-MM-DD").startOf("day");
    const endHijri = moment(endDate, "YYYY-MM-DD").endOf("day");

    const months = [];
    let current = startHijri.clone();

    while (current.isBefore(endHijri) || current.isSame(endHijri)) {
      const monthNumber = current.iMonth() + 1;
      const monthName = hijriMonths[monthNumber];
      const year = current.iYear();

      const monthStart = moment(current).startOf("iMonth").format("YYYY-MM-DD");
      const monthEnd = moment(current).endOf("iMonth").format("YYYY-MM-DD");

      months.push({
        monthNumber,
        monthName,
        year,
        startDate: monthStart,
        endDate: monthEnd,
      });

      current.add(1, "iMonth");
    }

    const results = [];

    for (const month of months) {
      const [rows] = await pool.query(
        `
              SELECT 
                  a.santri_id,
                  s.nama AS nama_santri,
                  SUM(a.hadir) AS hadir,
                  SUM(a.sakit) AS sakit,
                  SUM(a.pulang) AS pulang,
                  SUM(a.alpa) AS alpa,
                  SUM(a.izin) AS izin
              FROM absensi a
              JOIN santri s ON a.santri_id = s.id
              WHERE a.tanggal BETWEEN ? AND ?
              AND a.kelas_id = ?
              GROUP BY a.santri_id, s.nama
          `,
        [month.startDate, month.endDate, kelas_id]
      );

      rows.forEach((row) => {
        let existing = results.find((r) => r.santri_id === row.santri_id);

        if (!existing) {
          existing = {
            santri_id: row.santri_id,
            nama: row.nama_santri,
            total: [0, 0], // [totalHadir, totalTakHadir]
          };
          results.push(existing);
        }

        const hadir = Number(row.hadir) || 0;
        const sakit = Number(row.sakit) || 0;
        const pulang = Number(row.pulang) || 0;
        const alpa = Number(row.alpa) || 0;
        const izin = Number(row.izin) || 0;

        existing[month.monthName] = [hadir, sakit, pulang, alpa, izin];

        // Total per santri (total hadir & total tidak hadir)
        existing.total[0] += hadir;
        existing.total[1] += sakit + pulang + alpa + izin;
      });

      // Kalau bulan ini kosong, tetap tambahkan entry kosong biar konsisten
      results.forEach((r) => {
        if (!r[month.monthName]) {
          r[month.monthName] = [0, 0, 0, 0, 0];
        }
      });
    }

    // Setelah semua bulan diproses, ubah total jadi persen
    results.forEach((r) => {
      const totalHari = r.total[0] + r.total[1];

      const persenHadir =
        totalHari > 0
          ? ((r.total[0] / totalHari) * 100).toFixed(0) + " %"
          : "0 %";
      const persenTidakHadir =
        totalHari > 0
          ? ((r.total[1] / totalHari) * 100).toFixed(0) + " %"
          : "0 %";

      r.total = [persenHadir, persenTidakHadir];
    });

    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Terjadi kesalahan saat mengambil data",
      error: error.message,
    });
  }
});

app.post("/rekap-nilai-kelas", async (req, res) => {
  try {
    const { kelas_id } = req.body;

    if (!kelas_id) {
      return res.status(400).json({ error: "kelas_id wajib diisi" });
    }

    const sql = `
      SELECT  
  k.nama AS nama_kelas,
  pel.nama AS nama_pelajaran,
  s.nama AS nama_santri,
  p.rata_rata
FROM santri s
JOIN kelas k ON s.kelas_id = k.id
LEFT JOIN penilaian p ON p.santri_id = s.id
LEFT JOIN jadwal_guru_penguji j ON p.jadwal_id = j.id
LEFT JOIN pelajaran pel ON j.pelajaran_id = pel.id
WHERE s.kelas_id = ?
    `;

    const [rows] = await pool.query(sql, [kelas_id]);

    // Proses data menjadi pivot
    const rekap = {};

    rows.forEach(row => {
      const key = row.nama_santri;
      if (!rekap[key]) {
        rekap[key] = {
          nama_kelas: row.nama_kelas,
          nama_santri: row.nama_santri,
          nilai: {}
        };
      }
      rekap[key].nilai[row.nama_pelajaran] = row.rata_rata;
    });

    res.status(200).json(Object.values(rekap));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/jadwal-guru-penguji", async (req, res) => {
  try {
    const { guru_id } = req.body;

    if (!guru_id) {
      return res.status(400).json({ error: "guru_id wajib diisi" });
    }

    const sql = `
      SELECT 
        j.id AS jadwal_id,
        pel.nama AS pelajaran_nama,
        k.id AS kelas_id,
        k.nama AS kelas_nama,
        w.nama AS waktu_nama
      FROM jadwal_guru_penguji j
      JOIN pelajaran pel ON j.pelajaran_id = pel.id
      JOIN kelas k ON j.kelas_id = k.id
      JOIN waktu w ON j.waktu_id = w.id
      WHERE j.guru_id = ?
    `;

    const [rows] = await pool.query(sql, [guru_id]);
    res.status(200).json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post("/santri-by-kelas", async (req, res) => {
  try {
    const { kelas_id } = req.body;

    if (!kelas_id) {
      return res.status(400).json({ error: "kelas_id wajib diisi" });
    }

    const sql = `
      SELECT id, nama 
      FROM santri 
      WHERE kelas_id = ?
    `;

    const [rows] = await pool.query(sql, [kelas_id]);

    res.status(200).json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/penilaian-by-santri", async (req, res) => {
  try {
    const { jadwal_id, santri_id } = req.body;

    if (!jadwal_id || !santri_id) {
      return res.status(400).json({ error: "jadwal_id dan santri_id wajib diisi" });
    }

    const sql = `
      SELECT baris, makna, surah, pertanyaan 
      FROM penilaian 
      WHERE jadwal_id = ? AND santri_id = ?
    `;

    const [rows] = await pool.query(sql, [jadwal_id, santri_id]);

    if (rows.length === 0) {
      return res.status(200).json(null); // tidak ada penilaian
    }

    res.status(200).json(rows[0]); // kembalikan objek penilaian
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/penilaian", async (req, res) => {
  try {
    const { jadwal_id, santri_id, baris, makna, surah, pertanyaan } = req.body;

    if (!jadwal_id || !santri_id) {
      return res.status(400).json({ error: "jadwal_id dan santri_id wajib diisi" });
    }

    // Cek apakah data sudah ada
    const [existingRows] = await pool.query(
      `SELECT * FROM penilaian WHERE jadwal_id = ? AND santri_id = ?`,
      [jadwal_id, santri_id]
    );

    if (existingRows.length > 0) {
      // Data sudah ada → update sebagian
      const current = existingRows[0];

      const updatedBaris = baris !== undefined ? baris : current.baris;
      const updatedMakna = makna !== undefined ? makna : current.makna;
      const updatedSurah = surah !== undefined ? surah : current.surah;
      const updatedPertanyaan = pertanyaan !== undefined ? pertanyaan : current.pertanyaan;

      await pool.query(
        `UPDATE penilaian 
         SET baris = ?, makna = ?, surah = ?, pertanyaan = ? 
         WHERE jadwal_id = ? AND santri_id = ?`,
        [updatedBaris, updatedMakna, updatedSurah, updatedPertanyaan, jadwal_id, santri_id]
      );
    } else {
      // Data belum ada → insert baru
      await pool.query(
        `INSERT INTO penilaian (jadwal_id, santri_id, baris, makna, surah, pertanyaan)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          jadwal_id,
          santri_id,
          baris ?? null,
          makna ?? null,
          surah ?? null,
          pertanyaan ?? null,
        ]
      );
    }

    res.status(200).json({ message: "Penilaian berhasil disimpan." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/fcm-token', async (req, res) => {
  const { user_id, fcm_token, device_type } = req.body;

  if (!user_id || !fcm_token || !device_type) {
    return res.status(400).json({ message: 'user_id, fcm_token, dan device_type wajib diisi' });
  }

  try {
    // Cek apakah token untuk user dan device_type sudah ada
    const [rows] = await pool.query(
      'SELECT id, fcm_token FROM fcm_tokens WHERE user_id = ? AND device_type = ?',
      [user_id, device_type]
    );

    if (rows.length > 0) {
      // Jika token berbeda, update token dan updated_at
      if (rows[0].fcm_token !== fcm_token) {
        await pool.query(
          'UPDATE fcm_tokens SET fcm_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [fcm_token, rows[0].id]
        );
        return res.status(200).json({ message: 'FCM token berhasil diperbarui' });
      } else {
        // Token sama, tidak perlu update
        return res.status(200).json({ message: 'FCM token sudah terbaru' });
      }
    } else {
      // Insert token baru
      await pool.query(
        'INSERT INTO fcm_tokens (user_id, fcm_token, device_type) VALUES (?, ?, ?)',
        [user_id, fcm_token, device_type]
      );
      return res.status(201).json({ message: 'FCM token berhasil disimpan' });
    }
  } catch (error) {
    console.error('Error menyimpan FCM token:', error);
    return res.status(500).json({ message: 'Terjadi kesalahan server' });
  }
});

app.get("/jadwal-penguji-all", async (req, res) => {
  try {
    const sql = `
      SELECT 
        j.id AS jadwal_id,
        j.kelas_id,
        j.guru_id,
        j.waktu_id,
        j.pelajaran_id,
        g.nama AS guru_nama,
        k.nama AS kelas_nama,
        w.nama AS waktu_nama,
        pel.nama AS pelajaran_nama
      FROM jadwal_guru_penguji j
      JOIN guru g ON j.guru_id = g.id
      JOIN kelas k ON j.kelas_id = k.id
      JOIN waktu w ON j.waktu_id = w.id
      JOIN pelajaran pel ON j.pelajaran_id = pel.id
    `;
    const [rows] = await pool.query(sql);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/jadwal-penguji", async (req, res) => {
  try {
    const { kelas_id, guru_id, waktu_id, pelajaran_id } = req.body;

    // Validasi lengkap
    if (!kelas_id || !guru_id || !waktu_id || !pelajaran_id) {
      return res.status(400).json({ error: "Semua field (kelas, guru, waktu, pelajaran) harus diisi" });
    }

    const sql = `
      INSERT INTO jadwal_guru_penguji 
      (kelas_id, guru_id, waktu_id, pelajaran_id) 
      VALUES (?, ?, ?, ?)
    `;
    
    const [result] = await pool.query(sql, [
      kelas_id,
      guru_id,
      waktu_id,
      pelajaran_id
    ]);

    res.status(201).json({
      message: "Jadwal berhasil ditambahkan",
      insertedId: result.insertId
    });
  } catch (err) {
    console.error("Error insert jadwal:", err);
    res.status(500).json({ error: "Gagal menambahkan jadwal" });
  }
});


app.post("/jadwal-penguji/update", async (req, res) => {
  try {
    const { kelas_id, guru_id, waktu_id, pelajaran_id, id } = req.body;

    if (!kelas_id || !guru_id || !waktu_id || !id) {
      return res.status(400).json({ error: "Semua field harus diisi" });
    }

    const sql =
      "UPDATE jadwal_guru_penguji SET kelas_id = ?, guru_id = ?, waktu_id = ?, pelajaran_id = ? WHERE id = ?";
    const [result] = await pool.query(sql, [kelas_id, guru_id, waktu_id, pelajaran_id, id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Jadwal tidak ditemukan atau tidak ada perubahan" });
    }

    res.status(200).json({
      message: "Jadwal berhasil diperbarui",
    });
  } catch (err) {
    res.status(500).json({ error: "Terjadi kesalahan pada server: " + err.message });
  }
});

app.get("/pelajaran", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.id, p.nama
      FROM pelajaran p
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/leaderboard", async (req, res) => {
  const { tanggal_awal, tanggal_akhir } = req.body;

  if (!tanggal_awal || !tanggal_akhir) {
    return res.status(400).json({ error: "Tanggal awal dan akhir wajib diisi." });
  }

  try {
    const [rows] = await pool.query(`
      SELECT 
        g.nama AS nama_guru,
        COUNT(DISTINCT CONCAT(
          a.tanggal, '-', 
          a.waktu_id, '-', 
          CASE 
            WHEN a.kelas_id IN (37, 40) THEN 'group_37_40'
            WHEN a.kelas_id IN (38, 39, 41) THEN 'group_38_39_41'
            ELSE a.kelas_id
          END
        )) AS total_ngajar
      FROM 
        absensi a
      JOIN 
        guru g ON a.guru_id = g.id
      WHERE 
        a.tanggal BETWEEN ? AND ?
      GROUP BY 
        g.nama
      ORDER BY 
        total_ngajar DESC
    `, [tanggal_awal, tanggal_akhir]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// Jalankan server
app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
});
