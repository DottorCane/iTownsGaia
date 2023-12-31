#if defined(USE_FOG)
    float fogFactor = 1. - min( exp(-vFogDepth / fogDistance), 1.);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif
