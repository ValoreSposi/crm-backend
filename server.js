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
    'https://app.valoresposi.it/crm/',
    'http://app.valoresposi.it/crm/',
    'https://www.app.valoresposi.it/crm/',
    'http://www.app.valoresposi.it/crm/'
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

// ===== FUNZIONE PER STATISTICHE INVENTARIO =====
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

// ===== FUNZIONE PER REPORT VENDITE =====
async function getReportVendite(anno = null) {
    const client = new MongoClient(MONGODB_URI);
    
    try {
        await client.connect();
        const database = client.db(DATABASE_NAME);
        const collection = database.collection('prodotticlientes');
        
        const pipeline = [
            // Lookup cliente
            {
                $lookup: {
                    from: "clientes",
                    localField: "cliente",
                    foreignField: "_id",
                    as: "cliente_info"
                }
            },
            { $unwind: "$cliente_info" },
            
            // Lookup appuntamento
            {
                $lookup: {
                    from: "appuntamentos",
                    localField: "appuntamento",
                    foreignField: "_id",
                    as: "appuntamento_info"
                }
            },
            { $unwind: "$appuntamento_info" }
        ];
        
        // Filtro anno opzionale
        if (anno && anno !== 'all') {
            pipeline.push({
                $match: {
                    $expr: {
                        $eq: [
                            { $year: "$appuntamento_info.dataAppuntamento" },
                            parseInt(anno)
                        ]
                    }
                }
            });
        }
        
        // Resto della pipeline
        pipeline.push(
            // Lookup atelier
            {
                $lookup: {
                    from: "ateliers",
                    localField: "appuntamento_info.atelier",
                    foreignField: "_id",
                    as: "atelier_info"
                }
            },
            { $unwind: "$atelier_info" },
            
            // Lookup dipendente
            {
                $lookup: {
                    from: "users",
                    localField: "appuntamento_info.dipendente",
                    foreignField: "_id",
                    as: "dipendente_info"
                }
            },
            { $unwind: "$dipendente_info" },
            
            // Project dati principali
            {
                $project: {
                    DataAppuntamento: {
                        $dateToString: {
                            format: "%d/%m/%Y",
                            date: "$appuntamento_info.dataAppuntamento"
                        }
                    },
                    Atelier: "$atelier_info.nomeAtelier",
                    Dipendente: { $concat: ["$dipendente_info.firstName", " ", "$dipendente_info.lastName"] },
                    Cliente: { $concat: ["$cliente_info.nome", " ", "$cliente_info.cognome"] },
                    DataMatrimonio: {
                        $dateToString: {
                            format: "%d/%m/%Y",
                            date: "$appuntamento_info.dataMatrimonio"
                        }
                    },
                    prodotti: 1
                }
            },
            
            // Unwind prodotti
            { $unwind: "$prodotti" },
            
            // Lookup prodotto info
            {
                $lookup: {
                    from: "prodottis",
                    localField: "prodotti.prodotto",
                    foreignField: "_id",
                    as: "prodotto_info"
                }
            },
            { $unwind: "$prodotto_info" },
            
            // Lookup marca
            {
                $lookup: {
                    from: "marcaprodottis",
                    localField: "prodotto_info.marcaProdotto",
                    foreignField: "_id",
                    as: "marca_info"
                }
            },
            { $unwind: "$marca_info" },
            
            // Lookup categoria
            {
                $lookup: {
                    from: "categoriaprodottis",
                    localField: "prodotto_info.categoriaProdotto",
                    foreignField: "_id",
                    as: "categoria_info"
                }
            },
            { $unwind: "$categoria_info" },
            
            // Lookup tipologia
            {
                $lookup: {
                    from: "tipologiaprodottis",
                    localField: "prodotto_info.tipologiaProdotto",
                    foreignField: "_id",
                    as: "tipologia_info"
                }
            },
            { $unwind: "$tipologia_info" },
            
            // Lookup taglia
            {
                $lookup: {
                    from: "tagliaclientes",
                    localField: "prodotto_info.tagliaProdotto",
                    foreignField: "_id",
                    as: "taglia_info"
                }
            },
            { $unwind: "$taglia_info" },
            
            // Lookup modello
            {
                $lookup: {
                    from: "modelloprodottis",
                    localField: "prodotto_info.modelloProdotto",
                    foreignField: "_id",
                    as: "modello_info"
                }
            },
            { $unwind: "$modello_info" },
            
            // Lookup colore
            {
                $lookup: {
                    from: "coloreprodottis",
                    localField: "prodotto_info.coloreProdotto",
                    foreignField: "_id",
                    as: "colore_info"
                }
            },
            { $unwind: "$colore_info" },
            
            // Lookup carico con trim
            {
                $lookup: {
                    from: "caricoscaricos",
                    let: {
                        codiceProdotto: { $trim: { input: "$prodotti.codice" } }
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
                    as: "carico_info"
                }
            },
            
            // Add fornitoreId
            {
                $addFields: {
                    fornitoreId: {
                        $cond: {
                            if: { $gt: [{ $size: "$carico_info" }, 0] },
                            then: { $arrayElemAt: ["$carico_info.fornitore", 0] },
                            else: null
                        }
                    }
                }
            },
            
            // Lookup fornitore
            {
                $lookup: {
                    from: "fornitoris",
                    localField: "fornitoreId",
                    foreignField: "_id",
                    as: "fornitore_info"
                }
            },
            
            // Project finale
            {
                $project: {
                    _id: 0,
                    DataAppuntamento: 1,
                    Atelier: 1,
                    Dipendente: 1,
                    Cliente: 1,
                    DataMatrimonio: 1,
                    Categoria: "$categoria_info.descrizione",
                    Modello: "$modello_info.descrizione",
                    Marca: "$marca_info.descrizione",
                    Tipologia: "$tipologia_info.descrizione",
                    Taglia: "$taglia_info.descrizione",
                    Quantita: {
                        $convert: {
                            input: "$prodotti.quantita",
                            to: "double",
                            onError: 1,
                            onNull: 1
                        }
                    },
                    "Vendita/Noleggio": {
                        $cond: {
                            if: { $eq: ["$prodotti.checked", "2"] },
                            then: "Noleggiato",
                            else: "Venduto"
                        }
                    },
                    Colore: "$colore_info.descrizione",
                    Codice_Prodotto: "$prodotti.codice",
                    Prezzo_Vendita: {
                        $let: {
                            vars: {
                                prezzoBase: {
                                    $convert: {
                                        input: "$prodotti.prezzoVendita",
                                        to: "double",
                                        onError: 0,
                                        onNull: 0
                                    }
                                },
                                scontoPerc: {
                                    $convert: {
                                        input: "$prodotti.scontoPerc",
                                        to: "double",
                                        onError: 0,
                                        onNull: 0
                                    }
                                },
                                scontoValore: {
                                    $convert: {
                                        input: "$prodotti.sconto",
                                        to: "double",
                                        onError: 0,
                                        onNull: 0
                                    }
                                }
                            },
                            in: {
                                $subtract: [
                                    {
                                        $subtract: [
                                            "$$prezzoBase",
                                            {
                                                $multiply: [
                                                    "$$prezzoBase",
                                                    { $divide: ["$$scontoPerc", 100] }
                                                ]
                                            }
                                        ]
                                    },
                                    "$$scontoValore"
                                ]
                            }
                        }
                    },
                    Fornitore: {
                        $cond: {
                            if: { $gt: [{ $size: "$fornitore_info" }, 0] },
                            then: { $arrayElemAt: ["$fornitore_info.nomeFornitore", 0] },
                            else: "Non specificato"
                        }
                    },
                    PrezzoAcquisto: {
                        $cond: {
                            if: { $gt: [{ $size: "$carico_info" }, 0] },
                            then: {
                                $convert: {
                                    input: { $arrayElemAt: ["$carico_info.prodotti.prezzoAcquisto", 0] },
                                    to: "double",
                                    onError: -1,
                                    onNull: -1
                                }
                            },
                            else: -999
                        }
                    },
                    PrezzoCartellino: {
                        $cond: {
                            if: { $gt: [{ $size: "$carico_info" }, 0] },
                            then: {
                                $convert: {
                                    input: { $arrayElemAt: ["$carico_info.prodotti.prezzoCartellino", 0] },
                                    to: "double",
                                    onError: -1,
                                    onNull: -1
                                }
                            },
                            else: -999
                        }
                    },
                    PrezzoSuggerito: {
                        $cond: {
                            if: { $gt: [{ $size: "$carico_info" }, 0] },
                            then: {
                                $convert: {
                                    input: { $arrayElemAt: ["$carico_info.prodotti.prezzoSuggerito", 0] },
                                    to: "double",
                                    onError: -1,
                                    onNull: -1
                                }
                            },
                            else: -999
                        }
                    },
                    PrezzoAffiliato: {
                        $cond: {
                            if: { $gt: [{ $size: "$carico_info" }, 0] },
                            then: {
                                $convert: {
                                    input: { $arrayElemAt: ["$carico_info.prodotti.prezzoAffiliato", 0] },
                                    to: "double",
                                    onError: -1,
                                    onNull: -1
                                }
                            },
                            else: -999
                        }
                    }
                }
            }
        );
        
        // Esecuzione pipeline
        const cursor = collection.aggregate(pipeline, { allowDiskUse: true });
        const results = await cursor.toArray();
        
        return results;
        
    } catch (error) {
        console.error('Errore in getReportVendite:', error);
        throw error;
    } finally {
        await client.close();
    }
}

// ===== FUNZIONI CONVERSIONE CSV =====

// Funzione per convertire in CSV (inventario)
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

// Funzione per convertire report vendite in CSV
function convertVenditeToCSV(records) {
    const headers = [
        'Data Appuntamento',
        'Atelier',
        'Dipendente',
        'Cliente',
        'Data Matrimonio',
        'Categoria',
        'Modello',
        'Marca',
        'Tipologia',
        'Taglia',
        'Quantità',
        'Vendita/Noleggio',
        'Colore',
        'Codice Prodotto',
        'Prezzo Vendita',
        'Fornitore',
        'Prezzo Acquisto',
        'Prezzo Cartellino',
        'Prezzo Suggerito',
        'Prezzo Affiliato'
    ];
    
    let csvContent = headers.join(';') + '\n';
    
    records.forEach(record => {
        const row = [
            record.DataAppuntamento || '',
            record.Atelier || '',
            record.Dipendente || '',
            record.Cliente || '',
            record.DataMatrimonio || '',
            record.Categoria || '',
            record.Modello || '',
            record.Marca || '',
            record.Tipologia || '',
            record.Taglia || '',
            record.Quantita || 0,
            record['Vendita/Noleggio'] || '',
            record.Colore || '',
            record.Codice_Prodotto || '',
            (record.Prezzo_Vendita || 0).toFixed(2).replace('.', ','),
            record.Fornitore || '',
            record.PrezzoAcquisto === -999 ? 'N/D' : (record.PrezzoAcquisto || 0).toFixed(2).replace('.', ','),
            record.PrezzoCartellino === -999 ? 'N/D' : (record.PrezzoCartellino || 0).toFixed(2).replace('.', ','),
            record.PrezzoSuggerito === -999 ? 'N/D' : (record.PrezzoSuggerito || 0).toFixed(2).replace('.', ','),
            record.PrezzoAffiliato === -999 ? 'N/D' : (record.PrezzoAffiliato || 0).toFixed(2).replace('.', ',')
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

// ===== ENDPOINTS API =====

// Home con info di stato
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        message: 'CRM Export API - Valore Sposi',
        environment: process.env.NODE_ENV || 'development',
        database: process.env.MONGODB_URI ? 'configured' : 'not configured',
        endpoints: {
            // Inventario
            statistiche: '/api/statistiche',
            exportCSV: '/api/export-csv',
            magazzini: '/api/magazzini',
            // Vendite
            reportVendite: '/api/report-vendite',
            exportVenditeCSV: '/api/export-vendite-csv',
            // Sistema
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

// ===== ENDPOINTS INVENTARIO =====

// API: Ottieni statistiche inventario
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

// API: Export CSV inventario
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

// ===== ENDPOINTS VENDITE =====

// API: Report vendite
app.get('/api/report-vendite', async (req, res) => {
    try {
        const anno = req.query.anno || null;
        console.log(`[${new Date().toISOString()}] Richiesta report vendite - Anno: ${anno || 'tutti'}`);
        
        const records = await getReportVendite(anno);
        
        res.json({
            success: true,
            count: records.length,
            data: records
        });
        
    } catch (error) {
        console.error('Errore report vendite:', error);
        res.status(500).json({
            success: false,
            error: process.env.NODE_ENV === 'development' ? error.message : 'Errore nel recupero dati vendite'
        });
    }
});

// API: Export vendite CSV
app.get('/api/export-vendite-csv', async (req, res) => {
    try {
        const anno = req.query.anno || null;
        console.log(`[${new Date().toISOString()}] Export CSV vendite - Anno: ${anno || 'tutti'}`);
        
        const records = await getReportVendite(anno);
        const csv = convertVenditeToCSV(records);
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const annoSuffix = anno && anno !== 'all' ? `_${anno}` : '_completo';
        const filename = `report_vendite${annoSuffix}_${timestamp}.csv`;
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send('\ufeff' + csv);
        
    } catch (error) {
        console.error('Errore export vendite:', error);
        res.status(500).json({
            success: false,
            error: process.env.NODE_ENV === 'development' ? error.message : 'Errore durante l\'export vendite'
        });
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
   
   SISTEMA:
   GET /              → Stato API
   GET /api/health    → Health check
   
   INVENTARIO:
   GET /api/statistiche     → Dati inventario (JSON)
   GET /api/export-csv      → Export inventario (CSV)
   GET /api/magazzini       → Lista magazzini
   
   VENDITE:
   GET /api/report-vendite      → Report vendite (JSON)
   GET /api/export-vendite-csv  → Export vendite (CSV)

⚠️  IMPORTANTE: ${ALLOWED_ORIGINS.includes('tuosito.com') ? 'Modifica ALLOWED_ORIGINS con il tuo dominio!' : 'CORS configurato'}
`);
});
