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
app.post('/api/absensi-harian', async (req, res) => {
  try {
    const { kelas_id, tanggal, waktu_id } = req.body;

    if (!kelas_id || !tanggal || !waktu_id) {
      return res.status(400).json({ message: 'kelas_id, tanggal, dan waktu_id diperlukan' });
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

    const [absensiRows] = await pool.query(sqlAbsensi, [kelas_id, tanggal, waktu_id]);

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
    const defaultAbsensi = santriRows.map(santri => ({
      santri_id: santri.id,
      nama: santri.nama,
      hadir: 0,
      izin: 0,
      alpa: 0,
      pulang: 0,
      sakit: 0
    }));

    res.json(defaultAbsensi);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Terjadi kesalahan pada server' });
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

// ✅ INSERT DATA ABSENSI (Mencegah Duplikasi)
app.post("/absensi", async (req, res) => {
  try {
    const absensiArray = req.body.absensi;

    if (!Array.isArray(absensiArray) || absensiArray.length === 0) {
      return res.status(400).json({ error: "Data absensi harus berupa array dan tidak boleh kosong" });
    }

    for (const { tanggal, guru_id, kelas_id, waktu_id, santri_id, hadir, izin, alpa, pulang, sakit } of absensiArray) {
      // Cek apakah data sudah ada
      const checkSql = `SELECT COUNT(*) AS count FROM absensi WHERE tanggal = ? AND guru_id = ? AND kelas_id = ? AND waktu_id = ? AND santri_id = ?`;
      const [checkResult] = await pool.query(checkSql, [tanggal, guru_id, kelas_id, waktu_id, santri_id]);

      if (checkResult[0].count > 0) {
        return res.status(409).json({ error: "Data absensi sudah ada, tidak boleh duplikat" });
      }

      // Insert data jika belum ada
      const insertSql = `INSERT INTO absensi (tanggal, guru_id, kelas_id, waktu_id, santri_id, hadir, izin, alpa, pulang, sakit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      await pool.query(insertSql, [tanggal, guru_id, kelas_id, waktu_id, santri_id, hadir, izin, alpa, pulang, sakit]);
    }

    res.status(201).json({ message: "Absensi berhasil ditambahkan tanpa duplikasi" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ UPDATE STATUS ABSENSI
app.put("/absensi", async (req, res) => {
  try {
    const absensiArray = req.body.absensi;

    if (!Array.isArray(absensiArray) || absensiArray.length === 0) {
      return res.status(400).json({ error: "Data absensi harus berupa array dan tidak boleh kosong" });
    }

    let updatedCount = 0;
    let notFoundCount = 0;

    for (const { tanggal, guru_id, kelas_id, waktu_id, santri_id, hadir, izin, alpa, pulang, sakit } of absensiArray) {
      // Periksa apakah data absensi sudah ada
      const checkSql = `SELECT hadir, izin, alpa, pulang, sakit FROM absensi WHERE tanggal = ? AND guru_id = ? AND kelas_id = ? AND waktu_id = ? AND santri_id = ?`;
      const [currentStatus] = await pool.query(checkSql, [tanggal, guru_id, kelas_id, waktu_id, santri_id]);

      if (currentStatus.length === 0) {
        notFoundCount++;
        continue; // Jika tidak ditemukan, lanjutkan ke data berikutnya
      }

      const { hadir: h, izin: i, alpa: a, pulang: p, sakit: s } = currentStatus[0];
      if (h === hadir && i === izin && a === alpa && p === pulang && s === sakit) {
        continue; // Jika tidak ada perubahan, lewati update
      }

      // Update data absensi
      const updateSql = `
        UPDATE absensi 
        SET hadir = ?, izin = ?, alpa = ?, pulang = ?, sakit = ? 
        WHERE tanggal = ? AND guru_id = ? AND kelas_id = ? AND waktu_id = ? AND santri_id = ?
      `;
      const [updateResult] = await pool.query(updateSql, [hadir, izin, alpa, pulang, sakit, tanggal, guru_id, kelas_id, waktu_id, santri_id]);

      if (updateResult.affectedRows > 0) {
        updatedCount++;
      }
    }

    if (updatedCount === 0 && notFoundCount === absensiArray.length) {
      return res.status(404).json({ error: "Semua data absensi tidak ditemukan" });
    }

    res.status(200).json({ message: `${updatedCount} data absensi berhasil diperbarui` });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Absensi Bulanan
app.post('/absensi/bulanan', async (req, res) => {
  const { startDate, endDate, kelas_id, waktu_id } = req.body;

  if (!startDate || !endDate || !kelas_id || !waktu_id) {
      return res.status(400).json({ message: 'Parameter tidak lengkap' });
  }

  const query = `
      SELECT a.*, s.nama AS nama_santri
      FROM absensi a
      JOIN santri s ON a.santri_id = s.id
      WHERE a.tanggal BETWEEN ? AND ?
      AND a.kelas_id = ?
      AND a.waktu_id = ?
  `;

  try {
      const [rows] = await pool.query(query, [startDate, endDate, kelas_id, waktu_id]);

      // Cek isi rows langsung
      console.log('Raw data dari query:', rows);

      const tanggalList = generateTanggalRange(startDate, endDate);
      console.log('Tanggal Range:', tanggalList);

      const rekap = {};

      rows.forEach(row => {
          // Di sini kita mau tahu apakah row.tanggal bentuknya string atau object
          console.log('Raw tanggal dari DB:', row.tanggal, ' - typeof:', typeof row.tanggal);

          const tanggal = new Date(row.tanggal).toISOString().slice(0, 10);
console.log(`Raw tanggal dari DB:`, row.tanggal, ` - typeof:`, typeof row.tanggal);
console.log(`Tanggal formatted (${row.nama_santri}):`, tanggal);


          // Log hasil format-nya
          console.log(`Tanggal formatted (${row.nama_santri}):`, tanggal);

          const nama = row.nama_santri;

          if (!rekap[nama]) {
              rekap[nama] = {
                  nama,
                  tanggal: {},
                  jumlah: { H: 0, S: 0, P: 0, I: 0 }
              };

              tanggalList.forEach(tgl => {
                  rekap[nama].tanggal[tgl] = '-';
              });
          }

          let kode = 'H';
          if (row.sakit) kode = 'S';
          if (row.pulang) kode = 'P';
          if (row.izin) kode = 'I';

          rekap[nama].tanggal[tanggal] = kode;
          rekap[nama].jumlah[kode]++;
      });

      const finalResult = Object.values(rekap).map(santri => {
          return {
              nama: santri.nama,
              ...tanggalList.reduce((acc, tgl) => {
                  acc[tgl] = santri.tanggal[tgl]; // tetap '-'
                  return acc;
              }, {}),
              jumlah_h: santri.jumlah.H,
              jumlah_s: santri.jumlah.S,
              jumlah_p: santri.jumlah.P,
              jumlah_i: santri.jumlah.I
          };
      });

      res.json(finalResult);
  } catch (err) {
      console.error('Error saat query:', err);
      res.status(500).json({ message: 'Gagal mengambil data', error: err.message });
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





app.post('/absensi/bulanan/semuawaktu', async (req, res) => {
  const { startDate, endDate, kelas_id } = req.body;

  if (!startDate || !endDate || !kelas_id) {
      return res.status(400).json({ message: 'startDate, endDate, kelas_id wajib diisi' });
  }

  try {
      // Query ambil rekap absensi + nama waktu langsung
      const [rows] = await pool.query(`
          SELECT 
              a.waktu_id, 
              w.nama AS nama_waktu,
              a.santri_id, 
              s.nama AS nama_santri,
              SUM(a.hadir) AS total_hadir,
              SUM(a.sakit) AS total_sakit,
              SUM(a.pulang) AS total_pulang,
              SUM(a.izin) AS total_izin
          FROM absensi a
          JOIN santri s ON a.santri_id = s.id
          JOIN waktu w ON a.waktu_id = w.id
          WHERE 
              a.tanggal BETWEEN ? AND ?
              AND a.kelas_id = ?
          GROUP BY 
              a.waktu_id, w.nama, a.santri_id, s.nama
      `, [startDate, endDate, kelas_id]);

      // Hitung jumlah aktif belajar (jumlah hari antara startDate & endDate)
      const start = new Date(startDate);
      const end = new Date(endDate);
      const jumlah_aktif_belajar = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

      // Proses hasil query jadi format yang diminta
      const result = {};

      rows.forEach(row => {
          if (!result[row.nama_waktu]) {
              result[row.nama_waktu] = {
                  jumlah_aktif_belajar,
                  rekap_bulanan: []
              };
          }

          result[row.nama_waktu].rekap_bulanan.push({
              nama: row.nama_santri,
              jumlah_h: row.total_hadir,
              jumlah_s: row.total_sakit,
              jumlah_p: row.total_pulang,
              jumlah_i: row.total_izin
          });
      });

      res.json(result);
  } catch (error) {
      console.error('Error saat mengambil data absensi bulanan:', error);
      res.status(500).json({ message: 'Terjadi kesalahan server', error: error.message });
  }
});

// Jalankan server
app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
});
