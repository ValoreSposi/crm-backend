const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

// CONFIGURAZIONE SICURA - Usa variabili d'ambiente
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DATABASE_NAME = process.env.DATABASE_NAME || 'test';

// Verifica che le variabili siano configurate
if (!process.env.MONGODB_URI) {
    console.warn('⚠️  ATTENZIONE: MONGODB_URI non configurato! Usando database locale.');
}

// IMPORTANTE: Sostituisci 'tuosito.com' con il TUO dominio SiteGround!
const ALLOWED_ORIGINS = [
    'http://localhost:3000',
    'https://tuosito.com',
    'https://www.tuosito.com',
    'http://tuosito.com',
    'http://www.tuosito.com'
];

// Se hai una variabile d'ambiente per i domini permessi
if (process.env.ALLOWED_DOMAINS) {
    const additionalDomains = process.env.ALLOWED_DOMAINS.split(',');
    ALLOWED_ORIGINS.push(...additionalDomains);
}

// Configurazione CORS
app.use(cors({
    origin: function(origin, callback) {
        // Permetti richieste senza origin (tipo Postman)
        if (!origin) return callback(null, true);
        
        if (ALLOWED_ORIGINS.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.log(`CORS bloccato per: ${origin}`);
            callback(null, true); // Per test, poi metti false per sicurezza
        }
    },
    credentials: true
}));

app.use(express.json());

// Funzione per testare la connessione al database
async function testDatabaseConnection() {
    const client = new MongoClient(MONGODB_URI);
    try {
        await client.connect();
        console.log('✅ Connessione al database riuscita!');
        await client.db(DATABASE_NAME).command({ ping: 1 });
        return true;
    } catch (error) {
        console.error('❌ Errore connessione database:', error.message);
        return false;
    } finally {
        await client.close();
    }
}

// Funzione per ottenere statistiche CRM
async function getStatisticheCRM(magazzinoId = null) {
    const client = new MongoClient(MONGODB_URI);
    
    try {
        await client.connect();
        const database = client.db(DATABASE_NAME);
        const collection = database.collection('nuovaGiacenza');
        
        const pipeline = [];
        
        if (magazzinoId && magazzinoId !== 'all') {
            pipeline.push({
                $match: {
                    magazzino: new ObjectId(magazzinoId)
                }
            });
        }
        
        pipeline.push({
            $unwind: "$giacenza"
        });
        
        pipeline.push({
            $match: {
                $expr: {
                    $gte: [
                        {
                            $convert: {
                                input: "$giacenza.quantita",
                                to: "double",
                                onError: 0,
                                onNull: 0
                            }
                        },
                        1
                    ]
                }
            }
        });
        
        pipeline.push({
            $lookup: {
                from: "prodottis",
                localField: "giacenza.prodotto",
                foreignField: "_id",
                as: "prodottoInfo"
            }
        });
        
        pipeline.push({
            $unwind: "$prodottoInfo"
        });
        
        pipeline.push({
            $lookup: {
                from: "caricoscaricos",
                let: { 
                    codiceProdotto: { $trim: { input: "$giacenza.codice" } }
                },
                pipeline: [
                    { 
                        $match: { 
                            tipoCarico: "Carico"
                        } 
                    },
                    { $unwind: "$prodotti" },
                    {
                        $match: {
                            $expr: {
                                $eq: [
                                    { $trim: { input: "$prodotti.codice" } },
                                    "$$codiceProdotto"
                                ]
                            }
                        }
                    },
                    { $sort: { dataCarico: 1 } },
                    { $limit: 1 }
                ],
                as: "caricoInfo"
            }
        });
        
        pipeline.push({
            $addFields: {
                fornitoreId: {
                    $cond: {
                        if: { $gt: [{ $size: "$caricoInfo" }, 0] },
                        then: { $arrayElemAt: ["$caricoInfo.fornitore", 0] },
                        else: null
                    }
                }
            }
        });
        
        pipeline.push({
            $lookup: {
                from: "fornitoris",
                localField: "fornitoreId",
                foreignField: "_id",
                as: "fornitoreInfo"
            }
        });
        
        // Altri lookup
        const lookups = [
            { from: "categoriaprodottis", localField: "prodottoInfo.categoriaProdotto", as: "categoriaInfo" },
            { from: "marcaprodottis", localField: "prodottoInfo.marcaProdotto", as: "marcaInfo" },
            { from: "tipologiaprodottis", localField: "prodottoInfo.tipologiaProdotto", as: "tipologiaInfo" },
            { from: "modelloprodottis", localField: "prodottoInfo.modelloProdotto", as: "modelloInfo" },
            { from: "coloreprodottis", localField: "prodottoInfo.coloreProdotto", as: "coloreInfo" },
            { from: "tagliaclientes", localField: "prodottoInfo.tagliaProdotto", as: "tagliaInfo" },
            { from: "magazzinis", localField: "magazzino", as: "magazzinoInfo" }
        ];
        
        lookups.forEach(lookup => {
            pipeline.push({
                $lookup: {
                    from: lookup.from,
                    localField: lookup.localField,
                    foreignField: "_id",
                    as: lookup.as
                }
            });
            pipeline.push({
                $unwind: {
                    path: "$" + lookup.as,
                    preserveNullAndEmptyArrays: true
                }
            });
        });
        
        pipeline.push({
            $project: {
                _id: 0,
                magazzino: { $ifNull: ["$magazzinoInfo.nomeMagazzino", "Non specificato"] },
                codice: "$giacenza.codice",
                categoria: { $ifNull: ["$categoriaInfo.descrizione", "Non specificato"] },
                marca: { $ifNull: ["$marcaInfo.descrizione", "Non specificato"] },
                tipologia: { $ifNull: ["$tipologiaInfo.descrizione", "Non specificato"] },
                modello: { $ifNull: ["$modelloInfo.descrizione", "Non specificato"] },
                colore: { $ifNull: ["$coloreInfo.descrizione", "Non specificato"] },
                taglia: { $ifNull: ["$tagliaInfo.descrizione", "Non specificato"] },
                quantita: {
                    $convert: {
                        input: "$giacenza.quantita",
                        to: "double",
                        onError: 0,
                        onNull: 0
                    }
                },
                fornitore: {
                    $cond: {
                        if: {
                            $and: [
                                { $isArray: "$fornitoreInfo" },
                                { $gt: [{ $size: "$fornitoreInfo" }, 0] }
                            ]
                        },
                        then: { $arrayElemAt: ["$fornitoreInfo.nomeFornitore", 0] },
                        else: "Non specificato"
                    }
                },
                prezzoAcquisto: {
                    $convert: {
                        input: { $ifNull: ["$giacenza.prezzoAcquisto", "0"] },
                        to: "double",
                        onError: 0,
                        onNull: 0
                    }
                },
                prezzoCartellino: {
                    $convert: {
                        input: { $ifNull: ["$giacenza.prezzoCartellino", "0"] },
                        to: "double",
                        onError: 0,
                        onNull: 0
                    }
                },
                prezzoSuggerito: {
                    $convert: {
                        input: { $ifNull: ["$giacenza.prezzoSuggerito", "0"] },
                        to: "double",
                        onError: 0,
                        onNull: 0
                    }
                },
                prezzoAffiliato: {
                    $convert: {
                        input: { $ifNull: ["$giacenza.prezzoAffiliato", "0"] },
                        to: "double",
                        onError: 0,
                        onNull: 0
                    }
                }
            }
        });
        
        pipeline.push({
            $sort: {
                quantita: -1
            }
        });
        
        const cursor = collection.aggregate(pipeline, { allowDiskUse: true });
        const results = await cursor.toArray();
        
        return results;
        
    } catch (error) {
        console.error('Errore in getStatisticheCRM:', error);
        throw error;
    } finally {
        await client.close();
    }
}

// Funzione per convertire in CSV
function convertToCSV(products) {
    const headers = [
        'Magazzino',
        'Codice',
        'Categoria',
        'Marca',
        'Tipologia',
        'Modello',
        'Colore',
        'Taglia',
        'Quantità',
        'Fornitore',
        'Prezzo Acquisto',
        'Prezzo Cartellino',
        'Prezzo Suggerito',
        'Prezzo Affiliato',
        'Valore Totale'
    ];
    
    let csvContent = headers.join(';') + '\n';
    
    products.forEach(product => {
        const row = [
            product.magazzino || '',
            product.codice || '',
            product.categoria || '',
            product.marca || '',
            product.tipologia || '',
            product.modello || '',
            product.colore || '',
            product.taglia || '',
            product.quantita || 0,
            product.fornitore || '',
            (product.prezzoAcquisto || 0).toFixed(2).replace('.', ','),
            (product.prezzoCartellino || 0).toFixed(2).replace('.', ','),
            (product.prezzoSuggerito || 0).toFixed(2).replace('.', ','),
            (product.prezzoAffiliato || 0).toFixed(2).replace('.', ','),
            ((product.quantita || 0) * (product.prezzoAcquisto || 0)).toFixed(2).replace('.', ',')
        ];
        
        const escapedRow = row.map(value => {
            const strValue = String(value);
            if (strValue.includes(';') || strValue.includes('"') || strValue.includes('\n')) {
                return `"${strValue.replace(/"/g, '""')}"`;
            }
            return strValue;
        });
        
        csvContent += escapedRow.join(';') + '\n';
    });
    
    return csvContent;
}

// ENDPOINTS

// Home con info di stato
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        message: 'CRM Export API - Valore Sposi',
        environment: process.env.NODE_ENV || 'development',
        database: process.env.MONGODB_URI ? 'configured' : 'not configured',
        endpoints: {
            statistiche: '/api/statistiche',
            exportCSV: '/api/export-csv',
            magazzini: '/api/magazzini',
            health: '/api/health'
        }
    });
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
    const dbConnected = await testDatabaseConnection();
    
    res.json({
        status: dbConnected ? 'healthy' : 'unhealthy',
        database: dbConnected ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

// API: Ottieni statistiche
app.get('/api/statistiche', async (req, res) => {
    try {
        const magazzinoId = req.query.magazzino || null;
        console.log(`[${new Date().toISOString()}] Richiesta statistiche - Magazzino: ${magazzinoId || 'tutti'}`);
        
        const products = await getStatisticheCRM(magazzinoId);
        
        res.json({
            success: true,
            count: products.length,
            data: products
        });
        
    } catch (error) {
        console.error('Errore:', error);
        res.status(500).json({
            success: false,
            error: process.env.NODE_ENV === 'development' ? error.message : 'Errore interno del server'
        });
    }
});

// API: Export CSV
app.get('/api/export-csv', async (req, res) => {
    try {
        const magazzinoId = req.query.magazzino || null;
        console.log(`[${new Date().toISOString()}] Export CSV - Magazzino: ${magazzinoId || 'tutti'}`);
        
        const products = await getStatisticheCRM(magazzinoId);
        const csv = convertToCSV(products);
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `statistiche_crm_${timestamp}.csv`;
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send('\ufeff' + csv);
        
    } catch (error) {
        console.error('Errore:', error);
        res.status(500).json({
            success: false,
            error: process.env.NODE_ENV === 'development' ? error.message : 'Errore durante l\'export'
        });
    }
});

// API: Lista magazzini
app.get('/api/magazzini', async (req, res) => {
    const client = new MongoClient(MONGODB_URI);
    
    try {
        await client.connect();
        const database = client.db(DATABASE_NAME);
        const magazzini = await database.collection('magazzinis').find({}).toArray();
        
        res.json({
            success: true,
            data: magazzini.map(m => ({
                _id: m._id,
                nome: m.nomeMagazzino || 'Senza nome',
                ubicazione: m.ubicazioneMagazzino || ''
            }))
        });
        
    } catch (error) {
        console.error('Errore:', error);
        res.status(500).json({
            success: false,
            error: process.env.NODE_ENV === 'development' ? error.message : 'Errore nel recupero magazzini'
        });
    } finally {
        await client.close();
    }
});

// Test connessione all'avvio
testDatabaseConnection().then(connected => {
    if (!connected) {
        console.error('⚠️  ATTENZIONE: Impossibile connettersi al database!');
        console.error('   Controlla le variabili d\'ambiente su Render.com');
    }
});

// Avvio server
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║          SERVER CRM VALORE SPOSI - ATTIVO                     ║
╚═══════════════════════════════════════════════════════════════╝

🚀 Server in ascolto sulla porta: ${PORT}
🌍 Environment: ${process.env.NODE_ENV || 'development'}
🔒 Database: ${process.env.MONGODB_URI ? 'CONFIGURATO' : 'NON CONFIGURATO'}

📍 Endpoints disponibili:
   GET /              → Stato API
   GET /api/health    → Health check
   GET /api/statistiche
   GET /api/export-csv
   GET /api/magazzini

⚠️  IMPORTANTE: ${ALLOWED_ORIGINS.includes('tuosito.com') ? 'Modifica ALLOWED_ORIGINS con il tuo dominio!' : 'CORS configurato'}
`);
});
