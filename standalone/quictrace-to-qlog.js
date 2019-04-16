
function convertToQlog(qtrObject, filename){
    
    let {output: events, statistics} = convertEvents(qtrObject.events);

    let totalSent = 0;
    let totalLost = 0;
    for( let event of events ){
        if( event[2] == "PACKET_SENT" )
            totalSent += 1;
        else if( event[2] == "PACKET_LOST" )
            totalLost += 1;
    }

    let qlog = {
        qlog_version: "draft-00",
        title: "Converted from " + filename,
        description: "Converted from " + filename + " by the quictrace-to-qlog tool",

        summary: {
            trace_count: 1,
            max_duration: events.length > 0 ? events[ events.length - 1 ][0] : 0, // timestamp field (reference_time is 0, see below)
            max_outgoing_loss_rate: (totalLost / totalSent).toFixed(3),
            total_event_count: events.length
        },

        traces: [
            {
                vantage_point: {
                    type: "SERVER",
                    name: "Probably server, because debugging congestion stuff"
                },
                title: "QuicTrace only has a single connection per file",
                description: "this is that connection",

                configuration: {
                    time_offset: 0,
                    time_units: "us"
                },

                common_fields: {
                    reference_time: 0, // quictrace files do not include an epoch timestamp
                    group_id: qtrObject.destinationConnectionId ? qtrObject.destinationConnectionId : "UNKNOWN",
                    dcid: qtrObject.destinationConnectionId, // just additional metadata, not to be used in tools
                    scid: qtrObject.sourceConnectionId, // just additional metadata, not to be used in tools
                    protocol_type:  "QUIC_HTTP3"
                },

                event_fields: [
                    "relative_time",
                    "CATEGORY",
                    "EVENT_TYPE",
                    "TRIGGER",
                    "DATA"
                ],

                events: events
            }
        ]
    };



    return { qlog, statistics };
}

// quic-trace currently has no support for RETRY or VERSION_NEGOTIATION packets 
let encryptionLevelToPacketType = {
    "ENCRYPTION_INITIAL" : "INITIAL",
    "ENCRYPTION_HANDSHAKE" : "HANDSHAKE",
    "ENCRYPTION_0RTT" : "0RTT",
    "ENCRYPTION_1RTT" : "1RTT",

    "ENCRYPTION_UNKNOWN" : "UNKNOWN"
};

// quic-trace doesn't yet have support for post draft-14 loss recovery logic 
let reasonToTrigger = {
    "NORMAL_TRANSMISSION": "DEFAULT",
    "TAIL_LOSS_PROBE": "RETRANSMIT_PTO",
    "RTO_RETRANSMISSION": "RETRANSMIT_PTO",
    "PROBING_TRANSMISSION": "CC_BANDWIDTH_PROBE"
};
  
// quic-trace does not log: rtt variance or max_ack_delay
let transportStateToMetric = {
    "minRttUs": "min_rtt",
    "smoothedRttUs": "smoothed_rtt",
    "lastRttUs": "latest_rtt",
    "inFlightBytes": "bytes_in_flight",
    "cwndBytes": "cwnd",
    "pacingRateBps": "pacing_rate"
};

function convertEvents(events){

    let output = [];

    // some additional debug output for the console
    let statistics = {};
    statistics.eventTypes = new Map();
    statistics.frameTypes = new Map();
    statistics.encryptionLevels = new Map();
    statistics.eventCount = events.length;
    statistics.eventsMissingTransportState = 0;
    statistics.eventsMissingEncryptionLevel = 0;
    statistics.eventsMissingPacketNumber = 0;

    // quic-trace allows logigng for this info for each packet sent/received
    // in practice, many of these values stay exactly the same, so we would be logging things twice or more
    // keep a cache per-value and only log if the value actually changes
    // updateCount + valueList is just to get an idea of how "bad" the duplication is in practice
    // presentCount is to get a feel for what people are logging (e.g., cc_state and pacing_rate_bps are probably not very popular?) 
    let transportStateCache = new Map();
    transportStateCache.set("minRttUs",               { updateCount: 0, presentCount: 0, valueList: [], currentValue: -1} );
    transportStateCache.set("smoothedRttUs",          { updateCount: 0, presentCount: 0, valueList: [], currentValue: -1} );
    transportStateCache.set("lastRttUs",              { updateCount: 0, presentCount: 0, valueList: [], currentValue: -1} );

    transportStateCache.set("inFlightBytes",          { updateCount: 0, presentCount: 0, valueList: [], currentValue: -1} );
    transportStateCache.set("cwndBytes",              { updateCount: 0, presentCount: 0, valueList: [], currentValue: -1} );
    transportStateCache.set("pacingRateBps",          { updateCount: 0, presentCount: 0, valueList: [], currentValue: -1} );

    transportStateCache.set("congestionControlState", { updateCount: 0, presentCount: 0, valueList: [], currentValue: ""} );


    let qlogEvent = null;

    for( let event of events){

        if( event.encryptionLevel === undefined ){
            console.error("convertEvents: event has no encryptionLevel set...", event);
            statistics.eventsMissingEncryptionLevel += 1;
        }

        if( event.packetNumber === undefined ){
            console.error("convertEvents: event has no packetNumber set...", event);
            statistics.eventsMissingPacketNumber += 1;
        }

        let frames = [];

        if( event.frames ){
            for( let frame of event.frames ){

                if( statistics.frameTypes.has(frame.frameType) ){
                    statistics.frameTypes.set( frame.frameType, statistics.frameTypes.get( frame.frameType ) + 1);
                }
                else 
                    statistics.frameTypes.set( frame.frameType, 0);


                if( frame.frameType == "STREAM" ){

                    frames.push(
                        {
                            frame_type: "STREAM", 

                            id: frame.streamFrameInfo.streamId,
                            fin: frame.streamFrameInfo.fin ? frame.streamFrameInfo.fin : false,
                            length: frame.streamFrameInfo.length ? frame.streamFrameInfo.length : 0,
                            offset: frame.streamFrameInfo.offset ? frame.streamFrameInfo.offset : 0
                        }
                    );
                }
                else if( frame.frameType == "ACK"){

                    let ackRanges = [];
                    for( let ackBlock of frame.ackInfo.ackedPackets ){
                        ackRanges.push( [ackBlock.firstPacket, ackBlock.lastPacket] );

                        /*
                        ackRanges.push({
                            from: "" + ackBlock.firstPacket,
                            to: "" + ackBlock.lastPacket
                        });
                        */
                    }

                    frames.push(
                        {
                            frame_type: "ACK",

                            acked_ranges: ackRanges,
                            ack_delay: frame.ackInfo.ack_delay_us ? frame.ackInfo.ack_delay_us : 0
                        }
                    );
                }
                else if( frame.frameType == "RESET_STREAM"){

                    frames.push(
                        {
                            frame_type: "RESET_STREAM",
                            info: "frame type NOT SUPPORTED IN quic-trace to qlog converter yet"
                        }
                    );
                    /*
                    // Metadata for RST_STREAM frames.
                    message ResetStreamInfo {
                        optional uint64 stream_id = 1;
                        optional uint32 application_error_code = 2;
                        optional uint64 final_offset = 3;
                        };
                        */
                    
                }
                else if( frame.frameType == "CONNECTION_CLOSE"){
                    
                    frames.push(
                        {
                            frame_type: "CONNECTION_CLOSE",
                            info: "frame type NOT SUPPORTED IN quic-trace to qlog converter yet"
                        }
                    );
                    /*
                    // Metadata for CONNECTION_CLOSE/APPLICATION_CLOSE frames.
                    message CloseInfo {
                        optional uint32 error_code = 1;
                        optional string reason_phrase = 2;
                    };
                    */

                }
                else if( frame.frameType == "MAX_DATA"){
                    
                    frames.push(
                        {
                            frame_type: "MAX_DATA",
                            info: "frame type NOT SUPPORTED IN quic-trace to qlog converter yet"
                        }
                    );
                    /*
                // Metadata for MAX_DATA/MAX_STREAM_DATA frames.
                    message FlowControlInfo {
                        optional uint64 max_data = 1;
                        optional uint64 stream_id = 2;
                    };
                    */
                }
                else if( frame.frameType == "MAX_STREAM_DATA"){

                    frames.push(
                        {
                            frame_type: "MAX_STREAM_DATA",
                            info: "frame type NOT SUPPORTED IN quic-trace to qlog converter yet"
                        }
                    );
                    /*
                    // Metadata for MAX_DATA/MAX_STREAM_DATA frames.
                    message FlowControlInfo {
                        optional uint64 max_data = 1;
                        optional uint64 stream_id = 2;
                    };
                    */
                }
                else if( frame.frameType == "UNKNOWN_FRAME"){
                    
                    frames.push(
                        {
                            frame_type: "UNKNOWN"
                        }
                    );
                }
                else{
                    // PING, BLOCKED, STREAM_BLOCKED, PADDING
                    // these do not yet have metadata in quic-trace

                    frames.push(
                        {
                            frame_type: frame.frameType,
                            info: "frame type NOT SUPPORTED IN quic-trace to qlog converter yet"
                        }
                    );
                }
            }
        }
  

        if( event.eventType == "PACKET_SENT" ){

            let data = {
                packet_type: event.encryptionLevel ? encryptionLevelToPacketType[ event.encryptionLevel ] : "UNKNOWN_NOT_PRESENT_IN_QTR",
                header:{
                    packet_number: "" + event.packetNumber,
                    packet_size: event.packetSize
                },
                frames: frames
            };
            
            qlogEvent = [ 
                "" + event.timeUs, 
                "TRANSPORT", 
                "PACKET_SENT", 
                event.transmissionReason ? reasonToTrigger[event.transmissionReason] : "DEFAULT", 
                data
            ];
        }
        else if( event.eventType == "PACKET_RECEIVED" ){

            let data = {
                packet_type: event.encryptionLevel ? encryptionLevelToPacketType[ event.encryptionLevel ] : "UNKNOWN_NOT_PRESENT_IN_QTR",
                header:{
                    packet_number: "" + event.packetNumber,
                    packet_size: event.packetSize
                },
                frames: frames
            };
            
            qlogEvent = [ 
                "" + event.timeUs, 
                "TRANSPORT", 
                "PACKET_RECEIVED", 
                event.transmissionReason ? reasonToTrigger[event.transmissionReason] : "DEFAULT", 
                data
            ];
        } 
        else if( event.eventType == "PACKET_LOST" ){
            
            let data = {
                packet_number: "" + event.packetNumber
            };

            qlogEvent = [ 
                "" + event.timeUs, 
                "RECOVERY", 
                "PACKET_LOST", 
                "UNKNOWN", // quic-trace does not log reasons for why a packet was deemed "lost" (e.g., ACK, timeout, reorder threshold, etc.) 
                data
            ];

        } 
        else if( event.eventType == "APPLICATION_LIMITED" ){

            // note: this event is not in the I-D at this moment.
            // We see it as an application-specific log that custom tools would react to.

            qlogEvent = [ 
                "" + event.timeUs, 
                "RECOVERY", 
                "CUSTOM_CC_APPLICATION_LIMITED", 
                "UNKNOWN", // quic-trace does not log reasons for why we were application limited
                {} // quic-trace doesn't log any extra contextual data for APPLICATION_LIMITED events 
            ];
        } 
        else if( event.eventType == "EXTERNAL_PARAMETERS" ){
            // external parameters aren't used that much yet
            // mainly for things like NetInfo saying what type of connection you might expect
            // see BbrSenderTest:
            // https://cs.chromium.org/chromium/src/net/third_party/quiche/src/quic/core/congestion_control/bbr_sender_test.cc?q=BbrSenderT&sq=package:chromium&g=0&l=140
            // for the logging itself:
            // https://cs.chromium.org/chromium/src/net/third_party/quiche/src/quic/core/quic_trace_visitor.h?sq=package:chromium&g=0&l=17
            // https://cs.chromium.org/chromium/src/net/third_party/quiche/src/quic/core/quic_trace_visitor.cc?sq=package:chromium&g=0&l=278
        
            // note: this event is not in the I-D at this moment.
            // We see it as an application-specific log that custom tools would react to.

            qlogEvent = [ 
                "" + event.timeUs, 
                "RECOVERY", 
                "CUSTOM_EXTERNAL_NETWORK_PARAMETERS", 
                "UNKNOWN", // quic-trace does not log reasons for this
                {
                    bandwidth: event.externalNetworkParameters.bandwidthBps,
                    rtt: event.externalNetworkParameters.rttUs,
                    cwnd: event.externalNetworkParameters.cwndBytes
                }
            ];
        
        }
        else{
            // the quic-trace .proto also mentions an EXTERNAL_PARAMETERS event type, 
            // but this hasn't yet been observed in any of the seen quic-trace files
            console.error("convertEvents: Unknown event type : ", event.eventType);

            qlogEvent = [ 
                "" + event.timeUs, 
                "UNKNOWN", 
                event.eventType, 
                "UNKNOWN",
                {}
            ];
        }

        if( statistics.eventTypes.has( qlogEvent[2] ) ){
            let currentvalue = statistics.eventTypes.get(qlogEvent[2]);
            statistics.eventTypes.set( qlogEvent[2], currentvalue + 1 );
        }
        else
            statistics.eventTypes.set( qlogEvent[2], 1 );


        if( qlogEvent[4].packet_type ){
            let packetType = qlogEvent[4].packet_type;
            if( statistics.encryptionLevels.has( packetType ) ){
                let currentvalue = statistics.encryptionLevels.get(packetType);
                statistics.encryptionLevels.set( packetType, currentvalue + 1 );
            }
            else
                statistics.encryptionLevels.set( packetType, 1 );
        }


        output.push( qlogEvent );



        // in quic-trace, transportState is part of a PACKET_SENT/RECEIVED
        // in qlog, they are logged as separate events
        if( event.transportState === undefined || event.transportState === null ){
            // TODO: this is not an error per se: show in statistics, not as error 
            //console.error("convertEvents: event has no transportState set...", event);
            statistics.eventsMissingTransportState += 1;
        }
        else{
            const metricNames = Object.keys(event.transportState);
            
            let metrics = {};

            for( let metricName of metricNames  ){
                if( !transportStateCache.has(metricName) ){
                    console.error("convertEvents: unknown transportState parameter!", metricName);
                    continue;
                }

                let cachedInfo = transportStateCache.get(metricName);
                let newvalue = event.transportState[metricName];

                if( cachedInfo.currentValue != newvalue ){
                    cachedInfo.updateCount += 1;

                    // this one is special, has its own event in CC_STATE_UPDATE
                    if( metricName == "congestionControlState" ){
                        let ccdata = {};
                        ccdata.old = cachedInfo.currentValue;
                        ccdata.new = newvalue;

                        qlogEvent = [ 
                            "" + event.timeUs, 
                            "RECOVERY", 
                            "CC_STATE_UPDATE", 
                            "DEFAULT",
                            ccdata
                        ];
        
                        output.push( qlogEvent );
                    }
                    else // all other metrics belong together in METRIC_UPDATE
                        metrics[ transportStateToMetric[metricName] ] = newvalue;

                    cachedInfo.currentValue = newvalue;
                }

                cachedInfo.valueList.push( newvalue );
                cachedInfo.presentCount += 1;
            }

            if( Object.keys(metrics).length > 0 ){
                qlogEvent = [ 
                    "" + event.timeUs, 
                    "RECOVERY", 
                    "METRIC_UPDATE", 
                    "DEFAULT",
                    metrics
                ];

                output.push( qlogEvent );
            }
        }

    }

    console.log("Events missing TransportState (out of total): ", statistics.eventsMissingTransportState, statistics.eventCount);

    console.log("Statistics on encryption levels for packets: " );
    statistics.encryptionLevels.forEach((v, k, m) => console.log(`- Type: ${k} count: ${v}`));

    console.log("Statistics on event types: " );
    statistics.eventTypes.forEach((v, k, m) => console.log(`- Type: ${k} count: ${v}`));

    console.log("Statistics on frame types: " );
    statistics.frameTypes.forEach((v, k, m) => console.log(`- Type: ${k} count: ${v}`));

    console.log("Statistics on transportState metric stability: " );
    //transportStateCache.forEach((v, k, m) => console.log(`Metric:${k} present:${v.presentCount}, updated:${v.updateCount}, list:${JSON.stringify(v.valueList)}`));
    transportStateCache.forEach((v, k, m) => console.log(`- Metric:${k} value present:${v.presentCount}, actually contains updated value:${v.updateCount}`));

    statistics.transportStateCache = transportStateCache;

    return { output, statistics };

}