import Source from 'Source/Source';
import Fetcher from 'Provider/Fetcher';
import TMSSource from 'Source/TMSSource';
import URLBuilder from 'Provider/URLBuilder';
import Extent, { globalExtentTMS } from 'Core/Geographic/Extent';
import CRS from 'Core/Geographic/Crs';
import Gaia3DParserJSON from 'Parser/Gaia3DParserJSON';
import Gaia3DParserBinary from 'Parser/Gaia3DParserBinary';

// Source delle Tile3D da Gaia

//  Sistema di riferimento mondiale in gradi
const extent = new Extent(CRS.tms_4326, 0, 0, 0);

class Gaia3DPointSource extends TMSSource {
    constructor(source) {
       super(source);
       this.isTMSSource = source.isTMSSource;
       this.url = source.url;
       this.offset = source.offset;
       this.fetcher = Fetcher.arrayBuffer;
       this.parse = Gaia3DParserBinary.parse;
    }

    /*
    // Metodo che in base all'extent definisce l'URL da caricare.
    urlFromExtent(extent) {
        var result = URLBuilder.xyz(extent, this);
        console.log(result);
        return URLBuilder.xyz(extent, this);
    }

    onLayerAdded(options) {
        super.onLayerAdded(options);
        // Build extents of the set of identical zoom tiles.
        const parent = options.out.parent;
        // The extents crs is chosen to facilitate in raster tile process.
        const crs = parent ? parent.extent.crs : options.out.crs;
        if (this.tileMatrixSetLimits && !this.extentSetlimits[crs]) {
            this.extentSetlimits[crs] = {};
            extent.crs = this.crs;
            for (let i = this.zoom.max; i >= this.zoom.min; i--) {
                const tmsl = this.tileMatrixSetLimits[i];
                const { west, north } = extent.set(i, tmsl.minTileRow, tmsl.minTileCol).as(crs);
                const { east, south } = extent.set(i, tmsl.maxTileRow, tmsl.maxTileCol).as(crs);
                this.extentSetlimits[crs][i] = new Extent(crs, west, east, south, north);
            }
        }
    }

    extentInsideLimit(extent, zoom) {
        // This layer provides data starting at level = layer.source.zoom.min
        // (the zoom.max property is used when building the url to make
        //  sure we don't use invalid levels)
        return zoom >= this.zoom.min && zoom <= this.zoom.max &&
                (this.extentSetlimits[extent.crs] == undefined || this.extentSetlimits[extent.crs][zoom].intersectsExtent(extent));
    }
    */
    /*
    urlFromExtent(extent) {
        //Tengo traccia di tutte le tile richieste e della data di richiesta
        var key = extent.zoom + '_' + extent.row + '_' + extent.col;
        this.cacheTile[key]=Date.now();
        //console.log(extent);
        return URLBuilder.xyz(extent, this);
    }
    */
    /*
    loadData(extent, out) {
        console.log(extent);
        var key = extent.zoom + '_' + extent.row + '_' + extent.col;
        //this.cacheTile[key]=Date.now();
        return super.loadData(extent, out);
    }*/

}

export default Gaia3DPointSource;
