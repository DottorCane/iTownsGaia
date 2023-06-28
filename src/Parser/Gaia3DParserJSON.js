import * as THREE from 'three';

export default {

    parse: function parse(json, options) {

        if (json.features === undefined || json.features.length === 0) {
            return Promise.resolve(null);
        }

        // options = deprecatedParsingOptionsToNewOne(options);
        options.in = options.in || {};

        const out = options.out;
        const _in = options.in;
        // var crsIn = _in.crs || readCRS(json);

        // Format: MinX,MinY,MinZ,MaxX,MaxY,MaxZ,X1,Y1,Z1,[...],XN,YN,ZN,R1,G1,B1,A1,[...],RN,GN,BN,AN
        // const view = new DataView(buffer, 0, 6 * 4);
        // Per il momento definisco la Z in modo statico, poi si vedrà

        const min = new THREE.Vector3(json.bbox[0], json.bbox[1], 4167299);
        const max = new THREE.Vector3(json.bbox[2], json.bbox[3], 4167421);
        const box = new THREE.Box3(min, max);

        const positions = [];
        const color = [];
        var featureRead = null;

        for (let i = 0; i < json.features.length; i++) {
          // Genera coordinate casuali per ogni punto
          featureRead = json.features[i];
          var attribute = featureRead.properties;

          if (featureRead.geometry.type === 'MultiPoint') {
            for (var k = 0; k < featureRead.geometry.coordinates.length; k++) {
                 positions.push(featureRead.geometry.coordinates[k][0]);
                 positions.push(featureRead.geometry.coordinates[k][1]);
                 positions.push(featureRead.geometry.coordinates[k][2]);
                 // positions.push(featureRead.geometry.coordinates[k]);
                 // coordinates.push(featureRead.geometry.coordinates[k]);
            }
            color.push(attribute.r, attribute.g, attribute.b);
          } else {
            // Allora ho un punto singolo
            positions.push(featureRead.geometry.coordinates[0]);
            positions.push(featureRead.geometry.coordinates[1]);
            positions.push(featureRead.geometry.coordinates[2]);
            color.push(attribute.r, attribute.g, attribute.b);
          }
        }
        if (positions.length == 0) {
            return Promise.resolve(null);
        }
        const positionsTypedArray = new Float32Array(positions);
        const colorTypedArray = new Uint8Array(color);

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positionsTypedArray, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colorTypedArray, 3, true));
        geometry.boundingBox = box;
        return Promise.resolve(geometry);

        /*
        // Format: MinX,MinY,MinZ,MaxX,MaxY,MaxZ,X1,Y1,Z1,[...],XN,YN,ZN,R1,G1,B1,A1,[...],RN,GN,BN,AN
        const view = new DataView(buffer, 0, 6 * 4);
        const min = new THREE.Vector3(view.getFloat32(0, true), view.getFloat32(4, true), view.getFloat32(8, true));
        const max = new THREE.Vector3(view.getFloat32(12, true), view.getFloat32(16, true), view.getFloat32(20, true));
        const box = new THREE.Box3(min, max);

        var numPoints = Math.floor((buffer.byteLength - 24) / 16);
        numPoints = 50;

        const positions = new Float32Array(buffer, 24, 3 * numPoints);
        const colors = new Uint8Array(buffer, 24 + 3 * 4 * numPoints, 4 * numPoints);

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4, true));
        geometry.boundingBox = box;

        return Promise.resolve(geometry);
        */
    },
};
