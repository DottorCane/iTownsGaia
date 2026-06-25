import { Group } from 'three';
import * as THREE from 'three';
import GeometryLayer from 'Layer/GeometryLayer';
import FeatureProcessing from 'Process/FeatureProcessing';
import GaiaPoint3DProcessing from 'Process/GaiaPoint3DProcessing';
import PointsMaterial, { PNTS_MODE } from 'Renderer/PointsMaterial';
import Feature2Mesh from 'Converter/Feature2Mesh';
import Extent from 'Core/Geographic/Extent';
import Tile from 'Core/Tile/Tile';
import Coordinates from 'Core/Geographic/Coordinates';

const _tempBoxCenter = new THREE.Vector3();
const _tempBox3 = new THREE.Box3();

// Oggetti riusabili per il calcolo dei bounding box delle tile zoom-21
// (evita allocazioni nel loop di preUpdate)
const _camCoords4978 = new Coordinates('EPSG:4978', 0, 0, 0);
const _cornerSW = new Coordinates('EPSG:4326', 0, 0, 0);
const _cornerNE = new Coordinates('EPSG:4326', 0, 0, 0);
const _tileExt4326 = new Extent('EPSG:4326', [0, 0, 0, 0]);
const _tempTile = new Tile('EPSG:3857', 21, 0, 0);
const HALF_WORLD_3857 = 20037508.342789244;
const MAX_TILE_CANDIDATES = 400; // Limite di sicurezza

const _circleTexture = (function() {
    if (typeof document === 'undefined') {
        return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    
    // Disegniamo un cerchio solido netto invece di un gradiente sfumato
    context.beginPath();
    context.arc(32, 32, 30, 0, 2 * Math.PI, false);
    context.fillStyle = 'white';
    context.fill();
    
    const texture = new THREE.CanvasTexture(canvas);
    return texture;
}());

/**
 *
 * @property {boolean} isFeatureGeometryLayer - Used to checkout whether this layer is
 * a FeatureGeometryLayer. Default is true. You should not change this, as it is used
 * internally for optimisation.
 */
class GaiaGeometryLayer extends GeometryLayer {

    constructor(id, config = {}) {
        config.update = GaiaPoint3DProcessing.update;
        config.cacheLifeTime= 1000;
        super(id, config.object3d || new Group(), config);
        // this.cache.listTile = options.cacheLifeTime;
        this.isGaiaGeometryLayer = true;
        this.accurate = true;
        //this.buildExtent = !this.accurate;
        this.bboxes = {};
        this.bboxes.visible=true;

        if (config.offset){
            if (config.offset.x===undefined){
                config.offset.x = 0;
            }
            if (config.offset.y===undefined){
                config.offset.y = 0;
            }
            if (config.offset.z===undefined){
                config.offset.z = 0;
            }
            this.offset = new THREE.Vector3(config.offset.x, config.offset.y, config.offset.z);
            this.offsetInitial = new THREE.Vector3(config.offset.x, config.offset.y, config.offset.z);
        }


        // default config
        this.octreeDepthLimit = config.octreeDepthLimit || -1;
        this.pointBudget = config.pointBudget || 2000000;
        this.opacity = config.opacity || 1;
        this.pointSize = config.pointSize === 0 || !isNaN(config.pointSize) ? config.pointSize : 3;
        this.source = config.source;

        this.minIntensityRange = config.minIntensityRange || 0;
        this.maxIntensityRange = config.maxIntensityRange || 1;

        this.material = config.material || {};
        if (!this.material.isMaterial) {
            config.material = config.material || {};
            config.material.intensityRange = new THREE.Vector2(this.minIntensityRange, this.maxIntensityRange);
            this.material = new PointsMaterial(config.material);
        }
        this.material.defines = this.material.defines || {};
        this.mode = config.mode || PNTS_MODE.COLOR;
        
        this.stats = {
            pointsMemory: 0,
            pointsShow: 0,
            tilesVisible: 0,
            tilesTotal: 0,
            tilesLoading: 0,
            tilesDiscarded: 0
        };

        this._pendingTiles = new Map();  // key -> AbortController, per tile in download
        this._tileQueue = [];            // coda da ordinare per zoom: [{extent, zoom}]
        this._maxConcurrentDownloads = 4; // download simultanei massimi

        // Strategia di priorità: 'distance' | 'zoomAsc' | 'zoomDesc'
        // distance  = tile più vicina alla camera prima (default)
        // zoomAsc   = zoom basso prima (panoramica prima)
        // zoomDesc  = zoom alto prima (dettaglio prima)
        this.priorityMode = 'distance';

        // Abilita disabilita la texture sfumata (cerchi morbidi) invece dei quadrati base
        this.useSplatting = config.useSplatting !== undefined ? config.useSplatting : true;

        // Curva scalare configurabile per la dimensione dei punti in base allo zoom.
        // Se definita, l'algoritmo fa un'interpolazione lineare tra questi livelli.
        this.sizeScaleCurve = config.sizeScaleCurve || [
            { z: 17, scale: 4.0 }, // A zoom basso, punti molto più grandi (per tappare i buchi)
            { z: 19, scale: 2.0 }, // A zoom intermedio, punti medi
            { z: 21, scale: 1.0 }  // A zoom altissimo, dimensione base esatta (1x)
        ];

        // Fattore di scala dei punti per zoom (vecchio metodo, mantenuto come fallback)
        this.pointSizeScaleFactor = 0.6; // moltiplicatore per zoom step
        this.maxZoomRef = 21;             // zoom di riferimento (punti più piccoli)

        // Cache di materiali per zoom level (creati on-demand)
        this._materialsByZoom = new Map();
        //console.log("GaiaGeometryLayer");
    }

    createMaterialForGeometry(geometry) {
        let spacing = this.pointSize || 3.0; // fallback

        const count = (geometry.attributes && geometry.attributes.position && geometry.attributes.position.count) || geometry.numFeature;
        
        if (count > 0 && geometry.inExtent) {
            const ext = geometry.inExtent;
            if (ext.west !== undefined && ext.east !== undefined && ext.north !== undefined && ext.south !== undefined) {
                let w = Math.abs(ext.east - ext.west);
                let h = Math.abs(ext.north - ext.south);
                
                // Conversione grossolana in metri se siamo in gradi
                if (ext.crs === 'EPSG:4326') {
                    const avgLat = (ext.north + ext.south) / 2;
                    w *= 111320 * Math.cos(avgLat * Math.PI / 180);
                    h *= 111320;
                }
                
                if (w > 0 && h > 0) {
                    const area = w * h;
                    spacing = Math.sqrt(area / count);
                }
            }
        }

        // Limiti di sicurezza in metri
        if (isNaN(spacing) || !isFinite(spacing) || spacing <= 0) {
            spacing = this.pointSize || 3.0;
        }
        spacing = Math.max(0.01, Math.min(spacing, 50.0));

        // Fattore di overlap per far sfiorare/sovrapporre i punti e tappare i buchi
        const overlapFactor = this.overlapFactor || 1.3; 
        
        const config = {
            size: spacing * overlapFactor,
            sizeAttenuation: true, // Fondamentale: i punti ora sono in metri! Più ti avvicini più si ingrandiscono
            vertexColors: true,
            opacity: this.opacity,
        };

        if (this.useSplatting) {
            config.map = _circleTexture;
            config.transparent = this.opacity < 1;
            config.alphaTest = 0.5; // Taglio netto per mantenere le performance e la profondità
            config.depthWrite = true; // Cruciale per mantenere il sorting 3D
        } else {
            config.transparent = this.opacity < 1;
        }

        const mat = new THREE.PointsMaterial(config);
        
        // PATCH SHADER: Impedisce ai punti di rimpicciolirsi troppo in prospettiva
        // Questo garantisce che da chilometri di distanza restino visibili come polvere
        // invece di scomparire a zero pixel a causa di sizeAttenuation.
        mat.onBeforeCompile = (shader) => {
            shader.vertexShader = shader.vertexShader.replace(
                '#include <fog_vertex>',
                `#include <fog_vertex>
                 // Forza una dimensione minima su schermo (es. 2.5 pixel) per i dati lontani
                 gl_PointSize = max(2.5, gl_PointSize);
                `
            );
        };

        return mat;
    }

    createPointsElement(geometry){
        if (!geometry){
            return;
        }

        var key = geometry.inExtent.zoom + '_' + geometry.inExtent.row + '_' + geometry.inExtent.col;
        geometry.inExtent.key = key;

        for (const tilePoint of this.object3d.children) {
            if (tilePoint.geometry.inExtent.key === key ) {
                return;
            }
        }

        // Ogni tile ora ha il suo materiale dinamico basato sulla densità fisica dei punti
        const mat = this.createMaterialForGeometry(geometry);
        const points = new THREE.Points(geometry, mat);
        points.zoom = geometry.inExtent.zoom;
        points.lastTimeVisible = 0;

        var pointFinal;
        if (this.offset){
            pointFinal = points.geometry.boundingBox.min.clone().add(this.offset);
        }else{
            pointFinal = points.geometry.boundingBox.min.clone()
        }

        points.position.copy(pointFinal);

        var scaleVector = new THREE.Vector3(1, 1, 1);
        points.scale.copy(scaleVector);
        points.updateMatrixWorld();

        // addPickingAttribute(points);
        points.frustumCulled = false;
        points.matrixAutoUpdate = false;

        points.updateMatrix();
        points.layers.set(this.threejsLayer);
        points.layer = this;
        return points;
    }
    
    // Verifico se considerata la camera, la tile3D è visibile
    tilesCulling(camera, box3D, tileMatrixWorld) {
        if (box3D && camera.isBox3Visible(box3D, tileMatrixWorld)) {
            return true;
        }
        return false;
    }
    
    calcKeyExtent(inExtent){
        var key = inExtent.zoom + '_' + inExtent.row + '_' + inExtent.col;
        return key;
    }
    
    // In base allo Zoom c'è una distanza minima che rende il layer visibile
    checkTileVisibilitySq(zoom, distanceSq) {
        // Disabilitato: con il nuovo sistema di LOD basato su densità, i punti
        // scalano perfettamente in lontananza. Non c'è più bisogno di scartare
        // brutalmente le tile (es. zoom 21 scartato a soli 150m di distanza).
        return true;
    }

    updateMaterial(){
        // Aggiorna i materiali attivi direttamente sulle mesh (ora sono specifici per tile)
        for (const tilePoint of this.object3d.children) {
            const mat = tilePoint.material;
            if (mat) {
                mat.opacity = this.opacity;
                if (this.useSplatting) {
                    mat.map = _circleTexture;
                    mat.transparent = this.opacity < 1;
                    mat.alphaTest = 0.5;
                    mat.depthWrite = true;
                } else {
                    mat.map = null;
                    mat.transparent = this.opacity < 1;
                    mat.alphaTest = 0;
                    mat.depthWrite = true;
                }
                mat.needsUpdate = true;
            }
        }
    }
    updatePosition(){
        for (const tilePoint of this.object3d.children) {
            var pointFinal = tilePoint.geometry.boundingBox.min.clone().sub(this.offsetInitial);
            var pointFinal = pointFinal.add(this.offset);
            tilePoint.position.copy(pointFinal);
        }
    }

    update(context, layer, node, parent) {
        GaiaPoint3DProcessing.update(context, layer, node);
        //console.log(elt);
    }

    // Accoda una richiesta senza scatenare il download subito
    enqueueLoadTile(extent, dictAllTile, distanceSq) {
        const key = this.calcKeyExtent(extent);
        if (dictAllTile[key] || this._pendingTiles.has(key)) {
            return;
        }
        // Segna come pending subito per evitare duplicati nello stesso frame
        this._pendingTiles.set(key, null);
        // Salva sia distanza che zoom per supportare tutte le strategie di ordinamento
        this._tileQueue.push({ extent, key, distanceSq: distanceSq || 0, zoom: extent.zoom });
    }

    // Scarica fino a maxConcurrentDownloads tile dalla coda, ordinate per distanza ASC
    flushTileQueue(context) {
        if (this._tileQueue.length === 0) { return; }

        // Ordina in base alla strategia scelta
        const mode = this.priorityMode || 'distance';
        if (mode === 'distance') {
            this._tileQueue.sort((a, b) => a.distanceSq - b.distanceSq);
        } else if (mode === 'zoomAsc') {
            this._tileQueue.sort((a, b) => a.zoom - b.zoom);
        } else if (mode === 'zoomDesc') {
            this._tileQueue.sort((a, b) => b.zoom - a.zoom);
        }
        // 'fifo': nessun ordinamento, si processa in ordine di arrivo

        const slots = this._maxConcurrentDownloads - (this.stats.tilesLoading);
        const toDispatch = this._tileQueue.splice(0, Math.max(0, slots));

        for (const item of toDispatch) {
            this._doLoadTile(item.extent, item.key, context);
        }
    }

    _doLoadTile(extent, key, context) {
        var that = this;
        const controller = new AbortController();
        this._pendingTiles.set(key, controller);

        var promise = this.source.loadData(extent, this, { signal: controller.signal });
        if (promise == undefined || promise == null) {
            this._pendingTiles.delete(key);
            return;
        }
        that.stats.tilesLoading++;
        promise.then(
            function onTileLoadSuccess(v) {
                that._pendingTiles.delete(key);
                that.stats.tilesLoading--;

                // Scarta se non più visibile
                if (v && v.boundingBox && context && context.camera) {
                    // Clona e ingrandisce il bounding box per evitare che edifici molto alti 
                    // escano dal frustum (schermo) causando la cancellazione dell'intera tile
                    // quando in realtà la loro cima è ancora visibile (specialmente con viste a 45 gradi)
                    const expandedBox = v.boundingBox.clone();
                    expandedBox.expandByScalar(2000); // Espande di 2km in tutte le direzioni

                    _tempBoxCenter.set(
                        (expandedBox.max.x+expandedBox.min.x)/2,
                        (expandedBox.max.y+expandedBox.min.y)/2,
                        (expandedBox.max.z+expandedBox.min.z)/2
                    );
                    var distSq = context.camera.camera3D.position.distanceToSquared(_tempBoxCenter);
                    
                    // Controlla la visibilità usando il box espanso
                    var visible = context.camera.isBox3Visible(expandedBox, that.object3d.matrixWorld);
                    
                    if (distSq < 10000) { visible = true; }
                    if (visible) { visible = that.checkTileVisibilitySq(v.inExtent.zoom, distSq); }

                    if (!visible) {
                        v.dispose();
                        that.stats.tilesDiscarded++;
                        // Libera uno slot e avanza la coda
                        that.flushTileQueue(context);
                        return;
                    }
                }

                var points = that.createPointsElement(v);
                if (points != null) {
                    that.object3d.add(points);
                    that.object3d.updateMatrixWorld();
                }
                // Libera uno slot e avanza la coda
                that.flushTileQueue(context);
            },
            function onTileLoadError(e) {
                that._pendingTiles.delete(key);
                that.stats.tilesLoading--;
                that.flushTileQueue(context);
            }
        );
    }

    requestLoadTile(extent, dictAllTile, distanceSq) {
        // Mantenuto per compatibilità ma ora usa la coda
        this.enqueueLoadTile(extent, dictAllTile, distanceSq);
    }

    /**
     * Svuota tutta la coda, cancella i download in corso e rimuove le tile zoom-21
     * dalla scena. Al frame successivo preUpdate le ri-enumera con il modo corrente.
     */
    clearAndReload() {
        // 1. Abort tutti i download in corso
        for (const [key, controller] of this._pendingTiles.entries()) {
            if (controller) { controller.abort(); }
        }
        this._pendingTiles.clear();

        // 2. Svuota la coda
        this._tileQueue = [];
        this.stats.tilesLoading = 0;

        // 3. Rimuovi dalla scena tutte le tile zoom-21 (verranno ri-richieste)
        for (let i = this.object3d.children.length - 1; i >= 0; i--) {
            const item = this.object3d.children[i];
            if (item.zoom === 21) {
                if (item.geometry) { item.geometry.dispose(); }
                this.object3d.remove(item);
            }
        }
    }

    preUpdate(context, sources) {
        var camera = context.camera;
        var cameraPosition = camera.camera3D.position;
        var projectionMatrix = camera.camera3D.projectionMatrix;
        var viewMatrix = camera.camera3D.matrixWorldInverse;
        var frustum = new THREE.Frustum();
        var tileVisible = 0;
        var tileNotVisible = 0;
        var tileDraw = 0;
        frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(projectionMatrix, viewMatrix));

        // ─── Aggiorna visibilità delle tile GIÀ in scena ──────────────────────────
        var dictAllTile = {};
        for (const tilePoint of this.object3d.children) {
            dictAllTile[tilePoint.geometry.inExtent.key] = true;

            const boxBoundingBox = tilePoint.geometry.boundingBox;
            _tempBoxCenter.set(
                (boxBoundingBox.max.x + boxBoundingBox.min.x) / 2,
                (boxBoundingBox.max.y + boxBoundingBox.min.y) / 2,
                (boxBoundingBox.max.z + boxBoundingBox.min.z) / 2
            );
            const distanceSqCalc = camera.camera3D.position.distanceToSquared(_tempBoxCenter);

            let visible = context.camera.isBox3Visible(boxBoundingBox, this.object3d.matrixWorld);

            // Soglia di prossimità: tile entro 100m sempre visibili (workaround per falsi negativi)
            if (distanceSqCalc < 10000) { visible = true; }

            if (visible) { visible = this.checkTileVisibilitySq(tilePoint.zoom, distanceSqCalc); }

            if (visible) {
                tilePoint.visible = true;
                tilePoint.lastTimeVisible = 0;
                tileVisible++;
            } else {
                tilePoint.visible = false;
                tileNotVisible++;
                if (tilePoint.lastTimeVisible == 0) {
                    tilePoint.lastTimeVisible = Date.now();
                }
            }
        }
        // ──────────────────────────────────────────────────────────────────────────

        // ─── Enumerazione deterministca delle tile zoom-21 visibili ───────────────
        // Non dipende dai parent caricati: calcola direttamente dalla posizione
        // della camera quali tile zoom-21 intersecano il frustum.

        // Utilizza il livello di zoom massimo configurato dal layer o dalla sorgente,
        // evitando il valore hardcoded 21 che creava troppe richieste se i dati si fermavano prima.
        const ZOOM_DETAIL = Math.min(
            this.source?.zoom?.max ?? (this.zoom?.max ?? 21), 
            22
        );
        const camPos = camera.camera3D.position;
        const matrixWorld = this.object3d.matrixWorld;

        // Converto la camera in EPSG:4326 tramite EPSG:4978
        _camCoords4978.setFromValues(camPos.x, camPos.y, camPos.z);
        const camGeo = _camCoords4978.as('EPSG:4326');
        const camAlt = Math.abs(camGeo.z);

        // Raggio di ricerca: almeno 100m, scala con l'altitudine
        const searchRadius = Math.min(500, Math.max(100, camAlt * 2));

        // Calcola il range di tile zoom-21 in EPSG:3857 che coprono il cerchio
        const numTiles21 = 2 ** ZOOM_DETAIL;
        const tileSize3857 = (2 * HALF_WORLD_3857) / numTiles21;

        // Converto la posizione camera in EPSG:3857
        const camGeo3857 = _camCoords4978.as('EPSG:3857');
        const camX = camGeo3857.x;
        const camY = camGeo3857.y;

        const colMin = Math.max(0, Math.floor((camX - searchRadius + HALF_WORLD_3857) / tileSize3857));
        const colMax = Math.min(numTiles21 - 1, Math.floor((camX + searchRadius + HALF_WORLD_3857) / tileSize3857));
        const rowMin = Math.max(0, Math.floor((HALF_WORLD_3857 - (camY + searchRadius)) / tileSize3857));
        const rowMax = Math.min(numTiles21 - 1, Math.floor((HALF_WORLD_3857 - (camY - searchRadius)) / tileSize3857));

        // Stima altitudine massima dell'edificio per il bounding box 3D
        const estimatedMaxHeight = Math.max(camAlt + 50, 200);

        var visibleTilesKeys = new Set();
        let candidateCount = 0;

        for (let row = rowMin; row <= rowMax && candidateCount < MAX_TILE_CANDIDATES; row++) {
            for (let col = colMin; col <= colMax && candidateCount < MAX_TILE_CANDIDATES; col++) {
                candidateCount++;

                // Calcola l'extent geografico esatto di questa tile (deterministico, zero I/O)
                _tempTile.set(ZOOM_DETAIL, row, col);
                _tempTile.toExtent('EPSG:4326', _tileExt4326);

                // Costruisce il Box3 3D dai 2 angoli dell'extent (SW basso, NE alto)
                _cornerSW.setFromValues(_tileExt4326.west, _tileExt4326.south, 0);
                _cornerNE.setFromValues(_tileExt4326.east, _tileExt4326.north, estimatedMaxHeight);
                const pSW = _cornerSW.as('EPSG:4978');
                const pNE = _cornerNE.as('EPSG:4978');

                _tempBox3.min.set(
                    Math.min(pSW.x, pNE.x),
                    Math.min(pSW.y, pNE.y),
                    Math.min(pSW.z, pNE.z)
                );
                _tempBox3.max.set(
                    Math.max(pSW.x, pNE.x),
                    Math.max(pSW.y, pNE.y),
                    Math.max(pSW.z, pNE.z)
                );

                // Test frustum: se non visibile, salta (zero rete!)
                if (!context.camera.isBox3Visible(_tempBox3, matrixWorld)) {
                    continue;
                }

                // Distanza dalla camera (usata per ordinare la coda dei download)
                _tempBox3.getCenter(_tempBoxCenter);
                const distSq = camPos.distanceToSquared(_tempBoxCenter);

                // In iTowns il costruttore Extent prende (crs, west, east, south, north).
                // Per un extent TMS, dobbiamo creare un extent fittizio e poi assegnare zoom, row e col
                const ext = new Extent('EPSG:3857', 0, 0, 0, 0);
                ext.zoom = ZOOM_DETAIL;
                ext.row = row;
                ext.col = col;
                
                const key = this.calcKeyExtent(ext);
                visibleTilesKeys.add(key);
                this.requestLoadTile(ext, dictAllTile, distSq);
            }
        }
        // ──────────────────────────────────────────────────────────────────────────


        var timeToDelete = 5000;
        var timeNow = Date.now();

        // Verifico se ci sono degli elementi da cancellare dalla memoria in modo safe
        for (let i = this.object3d.children.length - 1; i >= 0; i--) {
            const item = this.object3d.children[i];
            if ((item.visible == false) && (item.lastTimeVisible > 0) && (timeNow - item.lastTimeVisible > timeToDelete)) {
                if (item.geometry) {
                    item.geometry.dispose();
                }
                this.object3d.remove(item);
            }
        }


        // Abort pending tiles che non servono più
        for (const [key, controller] of this._pendingTiles.entries()) {
            if (!visibleTilesKeys.has(key)) {
                if (controller) { controller.abort(); }
                this._pendingTiles.delete(key);
                this.stats.tilesDiscarded++;
            }
        }
        // Svuota anche la coda interna dei tile accodati ma non ancora avviati
        this._tileQueue = this._tileQueue.filter(item => visibleTilesKeys.has(item.key));

        // Avvia i download ordinati per zoom
        this.flushTileQueue(context);


        //Calcolo il numero massimo di punti da visualizzare per gli elementi attivi
        let numElement = 0;
        for (const pts of this.object3d.children) {
            if (pts.visible) {
                const count = pts.geometry.attributes.position.count;
                numElement += count;
            }
        }

        // this.pointBudget = 1000 * 1000 * 4;
        var numElementShow = numElement;

        var allTile = true;
        if (numElement > this.pointBudget) {
            if (allTile) {
                // Con questo metodo disegna tutte le tile ma in modo parziale, va bene se i dati sono distribuiti in modo uniforme
                // Calcolo Point budget
                numElementShow = 0;
                const reduction = this.pointBudget / numElement;
                for (var k = 0; k < this.object3d.children.length; k++) {
                    const tilePoint = this.object3d.children[k];
                    const count = Math.floor(tilePoint.geometry.numFeature * reduction);
                    if (count > 0) {
                        tilePoint.visible = true;
                        numElementShow += count;
                        tilePoint.geometry.setDrawRange(0, count);
                    } else {
                        tilePoint.geometry.setDrawRange(0, 0);
                        tilePoint.visible = false;
                    }
                }
            } else {
                // This format doesn't require points to be evenly distributed, so
                // we're going to sort the nodes by "importance" (= on screen size)
                // and display only the first N nodes
                const listTile = this.object3d.children.filter(obj => obj.visible == true);
                //listTile.sort((a, b) => a.distance - b.distance);
                listTile.sort((a, b) => b.zoom - a.zoom);
                // this.group.children.sort((p1, p2) => p2.userData.node.sse - p1.userData.node.sse);

                let limitHit = false;
                numElementShow = 0;
                for (const tilePoint of listTile) {
                    const count = tilePoint.geometry.numFeature;

                    if (tilePoint.visible && (limitHit || (numElementShow + count) > this.pointBudget)) {
                        tilePoint.visible = false;
                        tilePoint.geometry.setDrawRange(0, 0);
                        limitHit = true;
                    } else {
                        tilePoint.geometry.setDrawRange(0, count);
                        numElementShow += count;
                        tileDraw++;
                    }

                }
            }
        } else {
            tileDraw = tileVisible;
        }


        this.numElement = 'Point memory: ' + numElement + ' Point show: ' + numElementShow + ' tile total: ' + tileDraw + ' tile visible: ' + tileVisible + ' tile not visible: ' + tileNotVisible + ' ';
        this.stats.pointsMemory = numElement;
        this.stats.pointsShow = numElementShow;
        this.stats.tilesVisible = tileVisible;
        this.stats.tilesTotal = tileDraw;
        /*
        for (const tilePoint of this.object3d.children) {
            if (!tilePoint.visible){
                var key = tilePoint.geometry.inExtent.zoom + '_' + tilePoint.geometry.inExtent.row + '_' + tilePoint.geometry.inExtent.col;
                //this.numElement = this.numElement + key + " ";
            }
        }
        this.numElement = this.numElement + " visible: ";
        for (const tilePoint of this.object3d.children) {
            if (tilePoint.visible){
                var key = tilePoint.geometry.inExtent.zoom + '_' + tilePoint.geometry.inExtent.row + '_' + tilePoint.geometry.inExtent.col;
                //this.numElement = this.numElement + key + " ";
            }
        }*/
    }

    postUpdate() {

    }
}

export default GaiaGeometryLayer;
