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

        // Fattore di scala dei punti per zoom: i livelli bassi hanno punti più grandi
        // per compensare la bassa densità. Può essere sovrascritto dall'utente.
        this.pointSizeScaleFactor = 0.6; // moltiplicatore per zoom step
        this.maxZoomRef = 21;             // zoom di riferimento (punti più piccoli)

        // Cache di materiali per zoom level (creati on-demand)
        this._materialsByZoom = new Map();
        //console.log("GaiaGeometryLayer");
    }

    /**
     * Calcola la dimensione dei punti per un dato zoom level.
     * Zoom basso → punti grandi. Zoom alto (dettaglio) → punti piccoli.
     *
     * @param {number} zoom
     * @returns {number}
     */
    pointSizeForZoom(zoom) {
        const zoomDiff = this.maxZoomRef - zoom;
        return this.pointSize * (1 + zoomDiff * this.pointSizeScaleFactor);
    }

    /**
     * Restituisce (o crea) il materiale condiviso per un dato zoom level.
     *
     * @param {number} zoom
     * @returns {THREE.PointsMaterial}
     */
    getMaterialForZoom(zoom) {
        if (!this._materialsByZoom.has(zoom)) {
            const mat = new THREE.PointsMaterial({
                size: this.pointSizeForZoom(zoom),
                sizeAttenuation: false,
                vertexColors: true,
                opacity: this.opacity,
                transparent: this.opacity < 1,
            });
            this._materialsByZoom.set(zoom, mat);
        }
        return this._materialsByZoom.get(zoom);
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

        const points = new THREE.Points(geometry, this.getMaterialForZoom(geometry.inExtent.zoom));
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
        // points.tightbbox = geometry.boundingBox.applyMatrix4(points.matrix);
        points.layers.set(this.threejsLayer);
        points.layer = this;
        return points;
        //this.object3d.add(points);
        //this.object3d.updateMatrixWorld();
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
    checkTileVisibilitySq(zoom,distanceSq){
        if (zoom == 21 ){
            if (distanceSq > 150 * 150) { return false; }
        }else if (zoom == 20 ){
            if (distanceSq > 350 * 350) { return false; }
        }else if (zoom == 19 ) {
            if (distanceSq > 500 * 500) { return false; }
        }else if (zoom == 18 ) {
            if (distanceSq > 7500 * 7500) { return false; }
        }else if (zoom == 17 ) {
            if (distanceSq > 1000 * 1000) { return false; }
        }
        return true;
    }

    updateMaterial(){
        // Aggiorna tutti i materiali in cache (uno per zoom level)
        for (const [zoom, mat] of this._materialsByZoom.entries()) {
            mat.size = this.pointSizeForZoom(zoom);
            mat.opacity = this.opacity;
            mat.transparent = this.opacity < 1;
            mat.needsUpdate = true;
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
            function(v) {
                that._pendingTiles.delete(key);
                that.stats.tilesLoading--;

                // Scarta se non più visibile
                if (v && v.boundingBox && context && context.camera) {
                    _tempBoxCenter.set(
                        (v.boundingBox.max.x+v.boundingBox.min.x)/2,
                        (v.boundingBox.max.y+v.boundingBox.min.y)/2,
                        (v.boundingBox.max.z+v.boundingBox.min.z)/2
                    );
                    var distSq = context.camera.camera3D.position.distanceToSquared(_tempBoxCenter);
                    var visible = context.camera.isBox3Visible(v.boundingBox, that.object3d.matrixWorld);
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
            function(e) {
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

        const ZOOM_DETAIL = 21;
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

                const ext = new Extent('EPSG:3857', ZOOM_DETAIL, row, col);
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
