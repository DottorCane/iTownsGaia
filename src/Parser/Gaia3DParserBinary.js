import * as THREE from 'three';
import Coordinates from 'Core/Geographic/Coordinates';

// Oggetti riusabili pre-allocati fuori dal modulo per evitare allocazioni nel loop
const _coordsTemp = new Coordinates('EPSG:4326', 0, 0, 0);
const _coordsMin = new Coordinates('EPSG:4326', 0, 0, 0);
const _coordsMax = new Coordinates('EPSG:4326', 0, 0, 0);

export default {

    parse: function parse(buffer, options) {

        if (buffer.byteLength  < 50) {
            return Promise.resolve(null);
        }

        const view = new DataView(buffer);

        // Leggo bounding box della tile
        _coordsMin.setFromValues(view.getFloat64(0), view.getFloat64(8), view.getFloat64(16));
        const coordsMinPrj = _coordsMin.as('EPSG:4978');
        const minX = coordsMinPrj.x;
        const minY = coordsMinPrj.y;
        const minZ = coordsMinPrj.z;

        _coordsMax.setFromValues(view.getFloat64(24), view.getFloat64(32), view.getFloat64(40));
        const coordsMaxPrj = _coordsMax.as('EPSG:4978');

        const min = new THREE.Vector3(minX, minY, minZ);
        const max = new THREE.Vector3(coordsMaxPrj.x, coordsMaxPrj.y, coordsMaxPrj.z);

        const box = new THREE.Box3(min, max);
        box.zoom = options.extent.zoom;
        box.col = options.extent.col;
        box.row = options.extent.row;
        box.extent = options.extent;

        const xMin = view.getFloat64(0);
        const yMin = view.getFloat64(8);
        const zMin = view.getFloat64(16);

        const xDelta = view.getFloat64(48);
        const yDelta = view.getFloat64(56);
        const zDelta = view.getFloat64(64);

        const out = options.out;

        // Sottraggo i dati dell'extent della tile (9 * 8)
        const offset0 = 72;
        const bufferFeature = buffer.byteLength - offset0;
        // Le coordinate sono 3 uint16 (6 byte) e ogni colore è 3 byte
        const numFeatureBuffer = Math.floor(bufferFeature / ((3 * 2) + (3 * 1)));

        if (numFeatureBuffer === 0) {
            return Promise.resolve(null);
        }

        // Pre-allochiamo i TypedArray con la dimensione esatta: zero riallocazioni, zero copie finali
        const positionsTypedArray = new Float32Array(numFeatureBuffer * 3);
        const colorTypedArray = new Uint8Array(numFeatureBuffer * 3);

        let offset = offset0;
        let posIdx = 0;
        let colIdx = 0;
        let numFeature = 0;

        for (var index = 0; index < numFeatureBuffer; index++) {
            const valueX = view.getUint16(offset); offset += 2;
            const valueY = view.getUint16(offset); offset += 2;
            const valueZ = view.getUint16(offset); offset += 2;

            const X = (valueX * xDelta) + xMin;
            const Y = (valueY * yDelta) + yMin;
            const Z = (valueZ * zDelta) + zMin;

            // Riuso lo stesso oggetto Coordinates invece di crearne uno nuovo per ogni punto
            _coordsTemp.setFromValues(X, Y, Z);
            const coordsPrj = _coordsTemp.as('EPSG:4978');

            positionsTypedArray[posIdx++] = coordsPrj.x - minX;
            positionsTypedArray[posIdx++] = coordsPrj.y - minY;
            positionsTypedArray[posIdx++] = coordsPrj.z - minZ;

            //TODO: Non mi è chiaro perché i dati sono salvati in formato RGB ma se non vengono inseriti come RBG i colori non sono corretti
            colorTypedArray[colIdx++] = view.getInt8(offset); offset += 1; // R
            colorTypedArray[colIdx++] = view.getInt8(offset + 1); offset += 1; // B (swap)
            colorTypedArray[colIdx++] = view.getInt8(offset - 1); offset += 1; // G (swap)
            numFeature++;
        }

        if (numFeature === 0) {
            return Promise.resolve(null);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positionsTypedArray, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colorTypedArray, 3, true));
        geometry.boundingBox = box;
        geometry.inExtent = options.extent;
        geometry.numFeature = numFeature;
        return Promise.resolve(geometry);
    },
};

