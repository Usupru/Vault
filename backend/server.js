const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const session = require('express-session');
const archiver = require('archiver');
const { execSync } = require('child_process');
const { initDatabase } = require('./db');

const app = express();
let db = null;

app.use(session({
  secret: 'mi_secreto',
  resave: false,
  saveUninitialized: true
}));

app.use(express.urlencoded({ extended: true }));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

const escapeHtml = (value) => (
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
);

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
};

const getDiskFreeSpace = () => {
  try {
    if (process.platform === 'win32') {
      const driveRoot = path.parse(__dirname).root || 'C:\\';
      const driveLetter = `${driveRoot[0]}:`;
      const output = execSync(
        `wmic logicaldisk where "DeviceID='${driveLetter}'" get FreeSpace,Size /value`,
        { encoding: 'utf8' }
      );
      const lines = output.split(/\r?\n/);
      const freeLine = lines.find((line) => line.startsWith('FreeSpace='));
      if (!freeLine) {
        return null;
      }
      const free = Number.parseInt(freeLine.split('=')[1], 10);
      return Number.isNaN(free) ? null : free;
    }

    const dfOutput = execSync(`df -k "${__dirname}"`, { encoding: 'utf8' });
    const dfLines = dfOutput.trim().split(/\r?\n/);
    if (dfLines.length < 2) {
      return null;
    }
    const parts = dfLines[1].trim().split(/\s+/);
    const freeKb = Number.parseInt(parts[3], 10);
    return Number.isNaN(freeKb) ? null : freeKb * 1024;
  } catch (error) {
    return null;
  }
};

const getUploadedFileCount = async () => {
  const result = await db.get('SELECT COUNT(*) AS total FROM entry_files');
  return Number(result?.total || 0);
};

const getEntryWithFiles = async (id) => {
  const entry = await db.get(
    'SELECT id, created_at, title, description, category FROM entries WHERE id = ?',
    id
  );

  if (!entry) {
    return null;
  }

  const files = await db.all(
    `SELECT file_path AS path, file_name AS filename
     FROM entry_files
     WHERE entry_id = ?
     ORDER BY sort_order ASC, id ASC`,
    id
  );

  return {
    id: entry.id,
    createdAt: entry.created_at,
    title: entry.title,
    description: entry.description,
    category: entry.category,
    files
  };
};

const removeEntry = async (id) => {
  const files = await db.all(
    'SELECT file_path AS path FROM entry_files WHERE entry_id = ?',
    id
  );

  const deleted = await db.run('DELETE FROM entries WHERE id = ?', id);
  if (!deleted?.changes) {
    return false;
  }

  files.forEach((file) => {
    if (!file?.path) {
      return;
    }
    const filePath = path.join(__dirname, 'uploads', file.path);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      // Continue deleting the rest.
    }
  });

  return true;
};

const renderIndex = async (res) => {
  const indexTemplate = path.join(__dirname, 'public', 'index.html');
  const freeSpace = getDiskFreeSpace();
  const fileCount = await getUploadedFileCount();

  try {
    const html = await fs.promises.readFile(indexTemplate, 'utf8');
    const updatedHtml = html
      .replace('{{FREE_SPACE}}', freeSpace === null ? 'N/D' : formatBytes(freeSpace))
      .replace('{{FILE_COUNT}}', `${fileCount}`);

    res.send(updatedHtml);
  } catch (error) {
    res.status(500).send('<h1>Error al cargar la pagina</h1>');
  }
};

app.get('/', async (req, res) => {
  await renderIndex(res);
});

app.get('/index.html', async (req, res) => {
  await renderIndex(res);
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'subdomains', 'login.html'));
});

app.get('/error', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'subdomains', 'error.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'subdomains', 'register.html'));
});

app.get('/recover', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'subdomains', 'recover.html'));
});

app.get('/explore', async (req, res) => {
  const exploreTemplate = path.join(__dirname, 'public', 'subdomains', 'explore.html');
  let cardsHtml = '';

  const entries = await db.all(
    'SELECT id, created_at, title, description, category FROM entries ORDER BY datetime(created_at) DESC, id DESC'
  );

  if (entries.length > 0) {
    cardsHtml = entries.map((entry) => {
      const title = escapeHtml(entry.title || 'Sin titulo');
      const description = escapeHtml(entry.description || '');
      const category = escapeHtml(entry.category || 'otros');
      const id = escapeHtml(entry.id);
      const createdAt = escapeHtml(entry.created_at || entry.id);

      return `
            <div class="note-card" data-description="${description}" data-title="${title}" data-category="${category}" data-created="${createdAt}">
                <label class="select-card">
                    <input type="checkbox" class="note-select" value="${id}">
                    <span class="select-indicator"></span>
                </label>
                <a href="/explore/${id}" class="note-title">${title}</a>

                <p class="description">${description}</p>
            </div>
      `.trim();
    }).join('\n');
  }

  if (!cardsHtml) {
    cardsHtml = `
            <div class="note-card" data-description="No hay subidos aun." data-title="" data-category="otros" data-created="0">
                <a href="#" class="note-title">No hay archivos subidos</a>

                <p class="description">Sube el primero desde la pagina de subida.</p>
            </div>
    `.trim();
  }

  try {
    const html = await fs.promises.readFile(exploreTemplate, 'utf8');
    const modifiedHtml = html.replace('<!-- NOTES_PLACEHOLDER -->', cardsHtml);
    res.send(modifiedHtml);
  } catch (error) {
    res.status(500).send('<h1>Error al cargar la pagina</h1>');
  }
});

app.get('/upload', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'subdomains', 'upload.html'));
});

app.post('/delete/:id', async (req, res) => {
  const deleted = await removeEntry(req.params.id);
  if (!deleted) {
    return res.status(404).send('<h1>Archivo no encontrado</h1>');
  }

  res.redirect('/explore');
});

app.post('/delete-batch', async (req, res) => {
  const idsRaw = req.body?.ids || '';
  const ids = idsRaw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  for (const id of ids) {
    await removeEntry(id);
  }

  res.redirect('/explore');
});

app.post('/upload', async (req, res) => {
  try {
    await new Promise((resolve, reject) => {
      upload.array('files', 15)(req, res, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  } catch (error) {
    return res
      .status(400)
      .send(`<h1>Error al subir archivos</h1><p>${escapeHtml(error.message)}</p>`);
  }

  if (!req.files || req.files.length === 0) {
    return res
      .status(400)
      .send('<h1>Hubo un error</h1><p>No se subieron archivos. Por favor, intenta de nuevo.</p>');
  }

  const uniqueId = Date.now().toString();
  const createdAt = new Date().toISOString();
  const title = req.body.title || 'Sin titulo';
  const description = req.body.description || '';
  const category = String(req.body.category || 'otros').toLowerCase();

  await db.run('BEGIN');
  try {
    await db.run(
      'INSERT INTO entries (id, created_at, title, description, category) VALUES (?, ?, ?, ?, ?)',
      uniqueId,
      createdAt,
      title,
      description,
      category
    );

    for (let index = 0; index < req.files.length; index += 1) {
      const file = req.files[index];
      await db.run(
        'INSERT INTO entry_files (entry_id, file_path, file_name, sort_order) VALUES (?, ?, ?, ?)',
        uniqueId,
        file.filename,
        file.originalname,
        index
      );
    }

    await db.run('COMMIT');
  } catch (error) {
    await db.run('ROLLBACK');
    return res.status(500).send('<h1>Error al guardar la informacion</h1>');
  }

  res.redirect(`/explore/${uniqueId}`);
});

app.get('/explore/:id', async (req, res) => {
  const metadata = await getEntryWithFiles(req.params.id);
  if (!metadata) {
    return res.status(404).send('<h1>Archivo no encontrado</h1>');
  }

  const htmlTemplatePath = path.join(
    __dirname,
    'public',
    'plantillas',
    'resumenGratis',
    'plantillaResumenG.html'
  );

  let html;
  try {
    html = await fs.promises.readFile(htmlTemplatePath, 'utf8');
  } catch (error) {
    return res.status(500).send('<h1>Error al cargar la plantilla</h1>');
  }

  const safeTitle = escapeHtml(metadata.title || 'Sin titulo');
  const safeDescription = escapeHtml(metadata.description || '');

  let modifiedHtml = html
    .replace(/<title>.*<\/title>/, `<title>${safeTitle}</title>`)
    .replace(/<h2>.*<\/h2>/, `<h2>${safeTitle}</h2>`)
    .replace(
      /<p class="description">.*<\/p>/,
      `<p class="description">${safeDescription}</p>`
    )
    .replace(
      /<button[^>]*class="download-btn">Descargar<\/button>/,
      `<button onclick="window.location.href='/download/${req.params.id}'" class="download-btn">Descargar todo</button>`
    )
    .replace(/\/delete\/ID/g, `/delete/${req.params.id}`);

  const files = Array.isArray(metadata.files) ? metadata.files : [];
  const fileListHtml = files.map((file, index) => {
    const filePath = path.join(__dirname, 'uploads', file.path);
    let fileSize = '';
    try {
      const stats = fs.statSync(filePath);
      fileSize = formatBytes(stats.size);
    } catch (error) {
      fileSize = '';
    }

    return `
            <li class="file-item">
                <div>
                    <span class="file-name">${escapeHtml(file.filename)}</span>
                    ${fileSize ? `<span class="file-size">${fileSize}</span>` : ''}
                </div>
                <a href="/download/${req.params.id}/${index}" class="file-download">Descargar</a>
            </li>
    `.trim();
  }).join('\n');

  const renderedList = fileListHtml || '<li class="file-item empty">No hay archivos disponibles.</li>';
  modifiedHtml = modifiedHtml.replace('<!-- FILE_LIST_PLACEHOLDER -->', renderedList);

  res.send(modifiedHtml);
});

app.get('/download/:id/:index', async (req, res) => {
  const metadata = await getEntryWithFiles(req.params.id);
  if (!metadata) {
    return res.status(404).send('<h1>Archivo no encontrado</h1>');
  }

  const files = Array.isArray(metadata.files) ? metadata.files : [];
  const index = Number.parseInt(req.params.index, 10);
  const fileEntry = files[index];

  if (!fileEntry || !fileEntry.path) {
    return res.status(404).send('<h1>Archivo no encontrado</h1>');
  }

  const filePath = path.join(__dirname, 'uploads', fileEntry.path);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('<h1>Archivo no encontrado</h1>');
  }

  res.download(filePath, fileEntry.filename || path.basename(fileEntry.path));
});

app.get('/download/:id', async (req, res) => {
  const metadata = await getEntryWithFiles(req.params.id);
  if (!metadata) {
    return res.status(404).send('<h1>Archivo no encontrado</h1>');
  }

  const files = Array.isArray(metadata.files) ? metadata.files : [];
  const existingFiles = files.filter((file) => (
    file?.path && fs.existsSync(path.join(__dirname, 'uploads', file.path))
  ));

  if (existingFiles.length === 0) {
    return res.status(404).send('<h1>No hay archivos para descargar</h1>');
  }

  const zipFilename = `archivo_${req.params.id}.zip`;
  const zipPath = path.join(__dirname, 'temp', zipFilename);

  if (!fs.existsSync(path.join(__dirname, 'temp'))) {
    fs.mkdirSync(path.join(__dirname, 'temp'), { recursive: true });
  }

  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', {
    zlib: { level: 9 }
  });

  output.on('close', () => {
    res.download(zipPath, zipFilename, (error) => {
      if (error) {
        console.error('Error al enviar el archivo:', error);
        res.status(500).send('<h1>Error al descargar el archivo</h1>');
      }

      try {
        fs.unlinkSync(zipPath);
      } catch (unlinkError) {
        console.error('Error al eliminar el archivo temporal:', unlinkError);
      }
    });
  });

  archive.on('warning', (error) => {
    if (error.code === 'ENOENT') {
      console.warn('Advertencia:', error);
    } else {
      throw error;
    }
  });

  archive.on('error', (error) => {
    throw error;
  });

  archive.pipe(output);

  existingFiles.forEach((file, index) => {
    const originalName = file.filename || file.path;
    const safeName = `${index + 1}_${path.basename(originalName)}`;
    archive.file(
      path.join(__dirname, 'uploads', file.path),
      { name: safeName }
    );
  });

  archive.finalize();
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const startServer = async () => {
  db = await initDatabase();
  app.listen(8080, () => {
    console.log('Servidor corriendo en http://localhost:8080');
  });
};

startServer().catch((error) => {
  console.error('No se pudo iniciar el servidor:', error);
  process.exit(1);
});
