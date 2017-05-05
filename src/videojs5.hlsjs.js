'use strict';

var Hls = require('hls.js');

/**
 * hls.js source handler
 * @param source
 * @param tech
 * @constructor
 */
function Html5HlsJS(source, tech) {
  var options = tech.options_;
  var el = tech.el();
  var duration = null;
  var hls = new Hls(options.hlsjsConfig);

  /**
   * creates an error handler function
   * @returns {Function}
   */
  function errorHandlerFactory() {
    var _recoverDecodingErrorDate = null;
    var _recoverAudioCodecErrorDate = null;

    return function() {
      var now = Date.now();

      if (!_recoverDecodingErrorDate || (now - _recoverDecodingErrorDate) > 2000) {
        _recoverDecodingErrorDate = now;
        tech.clearTracks(['text'])
        tech.setSource(tech.currentSource_)
        //hls.recoverMediaError();
      }
      else if (!_recoverAudioCodecErrorDate || (now - _recoverAudioCodecErrorDate) > 2000) {
        _recoverAudioCodecErrorDate = now;
        hls.swapAudioCodec();
        tech.clearTracks(['text'])
        tech.setSource(tech.currentSource_)
        //hls.recoverMediaError();
      }
      else {
        console.error('Error loading media: File could not be played');
      }
    };
  }

  // create separate error handlers for hlsjs and the video tag
  var hlsjsErrorHandler = errorHandlerFactory();
  var videoTagErrorHandler = errorHandlerFactory();

  // listen to error events coming from the video tag
  el.addEventListener('error', function(e) {
    var mediaError = e.currentTarget.error;

    if (!mediaError) {
      return
    }
    else if (mediaError.code === mediaError.MEDIA_ERR_DECODE) {
      videoTagErrorHandler();
    }
    else {
      console.error('Error loading media: File could not be played');
    }
  });

  /**
   *
   */
  this.dispose = function() {
    hls.destroy();
  };

  /**
   * returns the duration of the stream, or Infinity if live video
   * @returns {Infinity|number}
   */
  this.duration = function() {
    return el.duration || 0
    //return duration || el.duration || 0;
  };

  // update live status on level load
  hls.on(Hls.Events.LEVEL_LOADED, function(event, data) {
    duration = data.details.live ? Infinity : data.details.totalduration;
  });

  // try to recover on fatal errors
  hls.on(Hls.Events.ERROR, function(event, data) {
    if (data.fatal) {
      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          hls.startLoad();
          break;
        case Hls.ErrorTypes.MEDIA_ERROR:
          hlsjsErrorHandler();
          break;
        default:
          console.error('Error loading media: File could not be played');
          break;
      }
    }
  });

  // handle missing audio/video in first few segments
  var noAudioTrack = false, noVideoTrack = false
  var snVideoNumberToReload = null, snAudioNumberToReload = null
  hls.on(Hls.Events.BUFFER_CREATED, function(event, data) {
    //console.info(event, data);
    if (typeof data.tracks === "object") {
      if (typeof data.tracks.audio === "undefined")
        noAudioTrack = true
      else if (typeof data.tracks.video === "undefined")
        noVideoTrack = true
    }
  })
  hls.on(Hls.Events.FRAG_PARSING_DATA, function(event, data) {
    if (data.type === "video") {
      if (noVideoTrack && snVideoNumberToReload === null) {
        snVideoNumberToReload = data.frag.sn
        //console.info("FRAG_PARSING_DATA will reload at SN for video", snVideoNumberToReload)
      }
    } else if (data.type === "audio") {
      if (noAudioTrack && snAudioNumberToReload === null) {
        snAudioNumberToReload = data.frag.sn
        //console.info("FRAG_PARSING_DATA will reload at SN for audio", snAudioNumberToReload)
      }
    }
  })
  hls.on(Hls.Events.FRAG_CHANGED, function(event, data) {
    //console.info("Hls.Events.FRAG_CHANGED", noVideoTrack, snVideoNumberToReload, noAudioTrack, snAudioNumberToReload, data)
    //console.info("=>", data.frag.sn)
    if (noVideoTrack && snVideoNumberToReload !== null) {
      if (snVideoNumberToReload <= data.frag.sn) {
        console.info("call recoverMediaError for video change", data)
        hlsjsErrorHandler();
        noVideoTrack = false
        snVideoNumberToReload = null
      }
    }
    if (noAudioTrack && snAudioNumberToReload !== null) {
      // reach exist audio track
      if (snAudioNumberToReload <= data.frag.sn) {
        // reload audio/video track
        console.info("call recoverMediaError for audio change", data)
        hlsjsErrorHandler();
        noAudioTrack = false
        snAudioNumberToReload = null
      }
    }
  })

  Object.keys(Hls.Events).forEach(function(key) {
    var eventName = Hls.Events[key];
    hls.on(eventName, function(event, data) {
      tech.trigger(eventName, data);
    });
  });

  // Intercept native TextTrack calls and route to video.js directly only
  // if native text tracks are not supported on this browser.
  if (!tech.featuresNativeTextTracks) {
    Object.defineProperty(el, 'textTracks', {
      value: tech.textTracks,
      writable: false
    });
    el.addTextTrack = function() {
      return tech.addTextTrack.apply(tech, arguments)
    }
  }

  // attach hlsjs to videotag
  hls.attachMedia(el);
  hls.loadSource(source.src);
}

var hlsTypeRE = /^application\/(x-mpegURL|vnd\.apple\.mpegURL)$/i;
var hlsExtRE = /\.m3u8/i;

var HlsSourceHandler = {
  canHandleSource: function(source) {
    if (source.skipContribHlsJs) {
      return '';
    }
    else if (hlsTypeRE.test(source.type)) {
      return 'probably';
    }
    else if (hlsExtRE.test(source.src)) {
      return 'maybe';
    }
    else {
      return '';
    }
  },
  handleSource: function(source, tech) {
    return new Html5HlsJS(source, tech);
  },
  canPlayType: function(type) {
    if (hlsTypeRE.test(type)) {
      return 'probably';
    }

    return '';
  }
};

if (Hls.isSupported()) {
  var videojs = require('video.js'); // resolved UMD-wise through webpack

  if (videojs) {
    videojs.getComponent('Html5').registerSourceHandler(HlsSourceHandler, 0);
  }
  else {
    console.warn('videojs-contrib-hls.js: Couldn\'t find find window.videojs nor require(\'video.js\')');
  }
}
