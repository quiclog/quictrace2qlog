    
function drawGraph(qlog, settings){
        console.log("DrawGraph", qlog, settings);
        
        document.getElementById("graphContainer").style.display = "block";
        document.getElementById("graphExplanation").style.display = "none";

		// because, low and behold, RGraph doesn't clear it itself fully apparently... 
		RGraph.clear(document.getElementById("recoveryPlot"),  'white');
		RGraph.clear(document.getElementById("recoveryPlot2"), 'white');
		RGraph.ObjectRegistry.clear()

		let logSet = qlog; 
		let title = qlog.title; 
		let xCap = 99999999999; 
		let yCap = 99999999999;

		let maxTimestamp = settings.maxX;
		let minTimestamp = settings.minX;
		
		let scale = 2;
		document.getElementById("recoveryPlot").width = window.innerWidth * 0.8;
		document.getElementById("recoveryPlot").height = 600;
		document.getElementById("recoveryPlot2").width = window.innerWidth * 0.8;
		document.getElementById("recoveryPlot2").height = 150;
	
		let multistreamDictionary = new Map();
		
		// we will add the qlog events to a separate dictionary for easy filtering and grouping of events 
		let addToDictionary = function( fieldIndices, timeMultiplier, subtractTime, dictionary, evt ){
			
			// we want : dictionary[category][event] = { timestamp, trigger, details }
			let category = evt[ fieldIndices.category ];
			let evtname  = evt[ fieldIndices.event ];
			let trigger  = evt[ fieldIndices.trigger ];
			let data 	 = evt[ fieldIndices.data ];
			
			if( !dictionary.has(category) )
				dictionary.set( category, new Map() );

			let categoryDictionary = dictionary.get(category);
			if( !categoryDictionary.has(evtname) )
				categoryDictionary.set( evtname, [] );
				
			let evtArray = categoryDictionary.get(evtname);
			
			let timestamp = (parseInt(evt[fieldIndices.timestamp]) * timeMultiplier) - subtractTime; 
			evtArray.push( { timestamp: timestamp, trigger: trigger, details: data } );
		}
		
		
		// in qlog, event_fields indicates which fields are actually present for each event and in which order 
		// so we need to get the indices for the events we need (time, category, event_type, trigger and data) 
        let startTime = 0;
        let subtractTime = 0;
		let fieldIndices = {};
		fieldIndices.timestamp = logSet.traces[0].event_fields.indexOf("time"); // typically 0 
		if( fieldIndices.timestamp == -1 ){
			fieldIndices.timestamp = logSet.traces[0].event_fields.indexOf("relative_time"); // typically 0 
			if( fieldIndices.timestamp == -1 ){
				alert("No proper timestamp present in qlog file. This tool doesn't support delta_time yet!");
			}
			else
				startTime = logSet.traces[0].common_fields.reference_time;
		}
		else{
            startTime = logSet.traces[0].events[0][fieldIndices.timestamp];
            subtractTime = startTime;
        }

		fieldIndices.category 	= logSet.traces[0].event_fields.indexOf("CATEGORY"); // typically 1
		fieldIndices.event 		= logSet.traces[0].event_fields.indexOf("EVENT_TYPE"); // typically 2
		fieldIndices.trigger 	= logSet.traces[0].event_fields.indexOf("TRIGGER"); // typically 3
		fieldIndices.data 		= logSet.traces[0].event_fields.indexOf("DATA"); // typically 4
		
		// default time is assumed to be ms. qlog time can also be in microseconds (us)
		let timeMultiplier = 1;
		if( logSet.traces[0].configuration && logSet.traces[0].configuration.time_units && logSet.traces[0].configuration.time_units == "us" ){
			timeMultiplier = 0.001;
		}
		
	   
		for( let evt of logSet.traces[0].events ){
			addToDictionary( fieldIndices, timeMultiplier, subtractTime * timeMultiplier, multistreamDictionary, evt );
		}
		
		
		{
			// ------------------------------------------------
			// ------------------------------------------------
			// ------------------------------------------------
			// plots for data segments 
			
			
			// we want to show:
			// - cumulative sent data
			// - cumulative acked data 
			// - lost data 
			
			// - we need to keep a cumulative number of bytes SENT and ACKED 
			// - we need to keep track of which packets contribute which data, so we properly draw the ACKs and LOST events 
			
			// - so we create: big sparse array of sent packets with packet number as index, data contains the amount of data it covers 
			let packetsSent = [];
		    let packetSentList = [];
			if (multistreamDictionary.has("TRANSPORT") && multistreamDictionary.get("TRANSPORT").has("PACKET_SENT")) {
				packetsSent = multistreamDictionary.get("TRANSPORT").get("PACKET_SENT");
			}
			
			let totalSentByteCount = 0;
			for( let packet of packetsSent ){
				
				let data = packet.details;
				
				if( !data.header.packet_size || data.header.packet_size == 0 ){
					console.error("Packet had invalid size! not counting!", packet);
					continue;
				}
				
				let packetOffsetStart = totalSentByteCount + 1;
				totalSentByteCount += data.header.packet_size;
				
				commonPacketSize = data.header.packet_size;
				
				packetSentList[ parseInt( data.header.packet_number ) ] = { time: packet.timestamp, from: packetOffsetStart, to: totalSentByteCount };
			}
			
			// - now we can create two more lists, which will contain a similar setup for ACKed and LOST packets 
			let packetAckedList = [];
			let packetLostList = [];
			let packetsReceived =[];
		    if (multistreamDictionary.has("TRANSPORT") && multistreamDictionary.get("TRANSPORT").has("PACKET_RECEIVED")) {
		       packetsReceived = multistreamDictionary.get("TRANSPORT").get("PACKET_RECEIVED");
            }
		    
            for( let packet of packetsReceived ){

                let data = packet.details;

                if( !data.frames )
                    continue;

                let ackFrames = [];
                for( let frame of data.frames ){
                    if( frame.frame_type == "ACK" )
                        ackFrames.push( frame );
                }

                if( ackFrames.length == 0 )
                    continue;

                // now we have the ACK frames. These are composed of ACK blocks, each ACKing a range of packet numbers 
                // we go over them all, look them up individually, and add them to packetAckedList
                for( let frame of ackFrames ){
                    for( let range of frame.acked_ranges ){
                        let from = parseInt( range[0] );
                        let to = parseInt( range[1] ); // up to and including

                        // ackedNr will be the ACKed packet number of one of our SENT packets here 
                        for( let ackedNr = from; ackedNr <= to; ++ackedNr ){
                            // find the originally sent packet 
                            let sentPacket = packetSentList[ ackedNr ]; 
                            if( !sentPacket ){
                                console.error("Packet was ACKed that we didn't send... ignoring", ackedNr, frame, packet);
                                continue;
                            }

                            // packets can be acked multiple times across received ACKs (duplicate ACKs). 
                            // This is quite normal in QUIC.
                            // We only want to show the FIRST time a packet was acked, so if the acked number already exists
                            // we do not overwrite it with a later timestamp
                            // TODO: MAYBE it's interesting to show duplicate acks as well, since this gives an indication of how long it took the peer to catch up
                            // e.g., if we have a long vertical line of acks, it means the peer might be sending too large ACK packets
                            if( !packetAckedList[ ackedNr ] )
                                packetAckedList[ ackedNr ] = { time: packet.timestamp, from: sentPacket.from, to: sentPacket.to };
                        }
                    }
                }
            }
		    
            let packetsLost = [];
			if (multistreamDictionary.has("RECOVERY") && multistreamDictionary.get("RECOVERY").has("PACKET_LOST")) {
				packetsLost = multistreamDictionary.get("RECOVERY").get("PACKET_LOST") || []; // || [] defaults to an empty array if there are no events of that type present in the log
            }
            for( let packet of packetsLost ){

                let data = packet.details;
                if( !data.packet_number ){
                    console.error("Packet was LOST that didn't contain a packet_number field...", packet);
                    continue;
                }

                let lostPacketNumber = parseInt( data.packet_number );
                let sentPacket = packetSentList[ lostPacketNumber ];
                if( !sentPacket ){
                    console.error("Packet was LOST that we didn't send... ignoring", lostPacketNumber, packet);
                    continue;
                }

                packetLostList[ lostPacketNumber ] = { time: packet.timestamp, from: sentPacket.from, to: sentPacket.to };
            }
			
			
			let scatters = [];
			let smallMaxX = 0;
			let smallMaxY = 0;
			let largeMaxX = 0;
			
			let lineWidth = 0.75 * scale;
			
			let scaleFormatter = function(obj, num){
				if( num > 1000 ){
					// 12000 -> 12k
					// 12010 -> 12010
					if( Math.round(num) % 1000 == 0 ){
						let k = Math.round(num / 1000);
						return k + "K";
					}
					else{
						return Math.round(num);
					}
				}
				else
					return Math.round(num);
			}
			
			// because rgraph doesn't allow a simple vertical line as a tickmark...
			function verticalTick ( packetSizeLUT, xMin, obj, data, x, y, xVal, yVal, xMax, yMax, color, dataset_index, data_index)
			{
				let packet = packetSizeLUT[data_index];
				let packetSize = packet.to - packet.from; 
				let heightOfPacket = Math.max(1, (obj.context.canvas.clientHeight / yMax) * packetSize); // (pixels per byte) * size in bytes 
				
				// packets are always a couple of ms separate, use this logic 
				let widthOfPacket = Math.max(3, (obj.context.canvas.clientWidth / (xMax - xMin)) * 2); // each packet is 5ms wide, except if that would be smaller than 5 px
				
				obj.context.lineCap     = 'butt'; // creator forgets to reset these when drawing his drawmarks
				obj.context.lineJoin    = 'butt'; // creator forgets to reset these when drawing his drawmarks

				obj.context.moveTo(x, y - heightOfPacket/2);
				obj.context.lineTo(x, y + heightOfPacket/2);
				let currentStrokeWidth = obj.context.lineWidth;
				obj.context.lineWidth = widthOfPacket;
				obj.context.stroke();
				obj.context.lineWidth = currentStrokeWidth; 
			}

		
			let packetsSentScatterData = []; 
			let packetsSentSizeLUT = []; // need to get tickmarks of the correct size drawn 

			for (let packetSentNumber in packetSentList) {
				let sentPacket = packetSentList[packetSentNumber];
				
				if( sentPacket.time < minTimestamp )
					continue;

				if( sentPacket.time > maxTimestamp )
					break;
				
				let x  = sentPacket.time;
				let y1 = sentPacket.from;
				let y2 = sentPacket.to;
				
				smallMaxX = Math.max(smallMaxX, x);
				smallMaxY = Math.max(smallMaxY, y2);
				
				// packetSent itself is a sparse array, packetsSentScatterData is dense
				// so we need an extra LUT to know the packet size to correctly calculate the height of the tickmarks later 
				packetsSentSizeLUT.push( sentPacket );
				packetsSentScatterData.push( [x, y1 + ((y2 - y1) / 2)] );
			}
			
			let packetsSentScatter = new RGraph.Scatter({
				id: 'recoveryPlot', 
				data: [packetsSentScatterData]
			});
			
			packetsSentScatter.set("title", title);
			packetsSentScatter.set("titleY", -50);
			packetsSentScatter.set("textSize", 6 * scale); 
			packetsSentScatter.set("scale.formatter", scaleFormatter);
			packetsSentScatter.set("xscale", true); // proper x-labels 
			packetsSentScatter.set("ylabelsCount", 5);
			packetsSentScatter.set("line", false);
			packetsSentScatter.set("scaleThousand", "");
			packetsSentScatter.set("backgroundGrid", false);
			packetsSentScatter.set("defaultcolor", "#0000FF");
			packetsSentScatter.set("tickmarks", (...args) => verticalTick(packetsSentSizeLUT, settings.minX, ...args));
				
			scatters.push( packetsSentScatter ); 
			
			
			
			let packetsAckedScatterData = []; 
			let packetsAckedSizeLUT = []; // need to get tickmarks of the correct size drawn 
			
			for (let packetSentNumber in packetAckedList) {
				let ackedPacket = packetAckedList[packetSentNumber];
				
				if( ackedPacket.time < minTimestamp )
					continue;

				if( ackedPacket.time > maxTimestamp )
					break;
				
				let x  = ackedPacket.time;
				let y1 = ackedPacket.from;
				let y2 = ackedPacket.to;
				
				smallMaxX = Math.max(smallMaxX, x);
				smallMaxY = Math.max(smallMaxY, y2);
				
				packetsAckedSizeLUT.push( ackedPacket );
				packetsAckedScatterData.push( [x, y1 + ((y2 - y1) / 2)] );
			}
			
			let packetsAckedScatter = new RGraph.Scatter({
				id: 'recoveryPlot', 
				data: [packetsAckedScatterData]
			});
			
			
			packetsAckedScatter.set("scale.formatter", scaleFormatter);
			packetsAckedScatter.set("backgroundGrid", false);
			packetsAckedScatter.set("scaleThousand", "");
			packetsAckedScatter.set("line", false);
			packetsAckedScatter.set("xscale", false); // x-labels would be messed up otherwhise 
			packetsAckedScatter.set("defaultcolor", "#6B8E23"); // green
			packetsAckedScatter.set("tickmarks",  (...args) => verticalTick(packetsAckedSizeLUT, settings.minX, ...args));
				
			scatters.push( packetsAckedScatter ); 
			
			
			
			
			let packetsLostScatterData = []; 
			let packetsLostSizeLUT = []; // need to get tickmarks of the correct size drawn 
			
			for (let packetSentNumber in packetLostList) {
				let lostPacket = packetLostList[packetSentNumber];

				if( lostPacket.time < minTimestamp )
					continue;

				if( lostPacket.time > maxTimestamp )
					break;
				
				let x  = lostPacket.time;
				let y1 = lostPacket.from;
				let y2 = lostPacket.to;
				
				smallMaxX = Math.max(smallMaxX, x);
				smallMaxY = Math.max(smallMaxY, y2);
				
				packetsLostSizeLUT.push( lostPacket );
				packetsLostScatterData.push( [x, y1 + ((y2 - y1) / 2)] );
			}
			
			let packetsLostScatter = new RGraph.Scatter({
				id: 'recoveryPlot', 
				data: [packetsLostScatterData]
			});
			
			
			packetsLostScatter.set("scale.formatter", scaleFormatter);
			packetsLostScatter.set("backgroundGrid", false);
			packetsLostScatter.set("scaleThousand", "");
			packetsLostScatter.set("line", false);
			packetsLostScatter.set("xscale", false); // x-labels would be messed up otherwhise 
			packetsLostScatter.set("defaultcolor", "#FF0000"); // red
			packetsLostScatter.set("tickmarks",  (...args) => verticalTick(packetsLostSizeLUT, settings.minX, ...args));
				
			scatters.push( packetsLostScatter );
			
			
			
			smallMaxX = Math.min( smallMaxX, xCap );
			
			smallMaxX = smallMaxX + ( Math.floor(smallMaxX * 0.01)); // add 5% of breathing space to the graph 
			smallMaxY = smallMaxY + ( Math.floor(smallMaxY * 0.01)); // add 5% of breathing space to the graph
			
			smallMaxX = Math.ceil( smallMaxX / 50 ) * 50;// round to the nearest number divisble by 50
			smallMaxY = Math.ceil( smallMaxY / 5000 ) * 5000;// round to the nearest number divisble by 5000
			
			for( let scatter of scatters ){
				scatter.set("xmin", settings.minX );
				if (packetsSentSizeLUT.length > 0 && packetsSentSizeLUT[0].from >= 5000) {
				  scatter.set("ymin", packetsSentSizeLUT[0].from );
				} else {
				  scatter.set("ymin", 0);
				}
				scatter.set("xmax", smallMaxX );
				scatter.set("ymax", smallMaxY );
			}
			
			largeMaxX = smallMaxX;

			
			
			
			// ------------------------------------------------
			// ------------------------------------------------
			// ------------------------------------------------
			
			let lines = [];

			let metricUpdates = [];
			if (multistreamDictionary.has("RECOVERY") && multistreamDictionary.get("RECOVERY").has("METRIC_UPDATE")) {
				metricUpdates = multistreamDictionary.get("RECOVERY").get("METRIC_UPDATE");
			};
			
			let bytesUpdates = [];
			let cwndupdates = [];
			let minRTTupdates = [];
			let smoothedRTTupdates = [];
			let lastRTTupdates = [];

			let rttMaxY = 0;
			
			for( let update of metricUpdates ){

				if( update.timestamp < minTimestamp )
					continue;

				if( update.timestamp > maxTimestamp )
					break;

				if( update.details.bytes_in_flight ){
					bytesUpdates.push( [update.timestamp, update.details.bytes_in_flight] ); 
                }
				if( update.details.cwnd ){
					cwndupdates.push( [update.timestamp, update.details.cwnd] ); 
                }
				if( update.details.min_rtt ){
					minRTTupdates.push( [update.timestamp, update.details.min_rtt * timeMultiplier] ); 
					rttMaxY = Math.max( rttMaxY,  update.details.min_rtt * timeMultiplier);
                }
				if( update.details.smoothed_rtt ){
					smoothedRTTupdates.push( [update.timestamp, update.details.smoothed_rtt * timeMultiplier] ); 
					rttMaxY = Math.max( rttMaxY,  update.details.smoothed_rtt * timeMultiplier);
                }
				if( update.details.latest_rtt ){
					lastRTTupdates.push( [update.timestamp, update.details.latest_rtt * timeMultiplier] ); 
					rttMaxY = Math.max( rttMaxY,  update.details.latest_rtt * timeMultiplier);
                }
            }
            
			function fixUpdates(originalUpdates){
				let output = [];

				if( originalUpdates.length == 0 )
					return output;

				let lastValue = 0;
				for( let point of originalUpdates ){
					if( originalUpdates.length > 0 )
						output.push( [point[0], lastValue] );
					
					output.push( point ); 
					lastValue = point[1];
				}
				// the final point should go all the way to the right 
				output.push( [ largeMaxX + 1,  output[ output.length - 1 ][1] ] );
				//output[0][0] = 0; // let's it start at the 0-point of the x-axis

				return output;
			}

			bytesUpdates 		= fixUpdates( bytesUpdates );
			cwndupdates 		= fixUpdates( cwndupdates );
			minRTTupdates 		= fixUpdates( minRTTupdates );
			smoothedRTTupdates 	= fixUpdates( smoothedRTTupdates );
			lastRTTupdates 		= fixUpdates( lastRTTupdates );

			let lineWidthCwnd = 1 * scale;
			
			if( bytesUpdates.length > 0 ){
				let inFlightLine = new RGraph.Scatter({
					id: 'recoveryPlot', 
					data: bytesUpdates
				});
				
				inFlightLine.set("tickmarks", "circle");
				inFlightLine.set("ticksize", 4);	
				inFlightLine.set("defaultcolor", ['#808000']);
				inFlightLine.set("xmin", settings.minX );
				inFlightLine.set("ymin", (packetsSentSizeLUT[0].from < 5000) ? 0 : packetsSentSizeLUT[0].from );
				inFlightLine.set("xmax", smallMaxX );
				inFlightLine.set("ymax", smallMaxY );
				inFlightLine.set("line.colors", ['#808000']); // kahki 
				inFlightLine.set("line", true);
				inFlightLine.set("lineLinewidth", lineWidthCwnd);
				inFlightLine.set("backgroundGrid", false);
				inFlightLine.set("scaleThousand", "");
				inFlightLine.set("xscale", false); // x-labels would be messed up otherwhise 
				inFlightLine.set("scale.formatter", scaleFormatter);
				lines.push(inFlightLine);
			}


			
			if( cwndupdates.length > 0 ){
				let cwndLine = new RGraph.Scatter({
					id: 'recoveryPlot', 
					data: cwndupdates
				});
				
				cwndLine.set("tickmarks", "cross");
				cwndLine.set("defaultcolor", ['#8A2BE2']);
				cwndLine.set("xmin", settings.minX );
				cwndLine.set("ymin", (packetsSentSizeLUT[0].from < 5000) ? 0 : packetsSentSizeLUT[0].from );
				cwndLine.set("xmax", smallMaxX );
				cwndLine.set("ymax", smallMaxY );
				cwndLine.set("line.colors", ['#8A2BE2']); // indigo 
				cwndLine.set("line", true);
				cwndLine.set("lineLinewidth", lineWidthCwnd);
				cwndLine.set("backgroundGrid", false);
				cwndLine.set("scaleThousand", "");
				cwndLine.set("xscale", false); // x-labels would be messed up otherwhise 
				cwndLine.set("scale.formatter", scaleFormatter);
				lines.push(cwndLine);
			}



			rttMaxY = Math.ceil( rttMaxY / 10 ) * 10;// round to the nearest number divisble by 10 (ms)

			if( minRTTupdates.length > 0 ){
				let minRTTline = new RGraph.Scatter({
					id: 'recoveryPlot2', 
					data: minRTTupdates
				});
				
				minRTTline.set("tickmarks", "plus");
				minRTTline.set("ticksize", 3);
				minRTTline.set("defaultcolor", ['#C96480']);
				minRTTline.set("xmin", settings.minX );
				minRTTline.set("ymin", 0 );
				minRTTline.set("xmax", smallMaxX );
				minRTTline.set("ymax", rttMaxY );
				minRTTline.set("line.colors", ['#C96480']); // pinkish
				minRTTline.set("line", true);
				minRTTline.set("backgroundGrid", true);
				minRTTline.set("scaleThousand", "");
				minRTTline.set("xscale", false);// x-labels would be messed up otherwhise 
				lines.push(minRTTline);
			}


			if( smoothedRTTupdates.length > 0 ){
				let smoothRTTline = new RGraph.Scatter({
					id: 'recoveryPlot2', 
					data: smoothedRTTupdates
				});
				
				smoothRTTline.set("tickmarks", "cross");
				smoothRTTline.set("ticksize", 4);
				smoothRTTline.set("defaultcolor", ['#8a554a']);
				smoothRTTline.set("xmin", settings.minX );
				smoothRTTline.set("ymin", 0 );
				smoothRTTline.set("xmax", smallMaxX );
				smoothRTTline.set("ymax", rttMaxY );
				smoothRTTline.set("line.colors", ['#8a554a']); // brown
				smoothRTTline.set("line", true);
				smoothRTTline.set("backgroundGrid", true);
				smoothRTTline.set("scaleThousand", "");
				smoothRTTline.set("xscale", true); 
				smoothRTTline.set("scale.formatter", scaleFormatter);
				lines.push(smoothRTTline);
			}
			

			if( lastRTTupdates.length > 0 ){
				let latestRTTline = new RGraph.Scatter({
					id: 'recoveryPlot2', 
					data: lastRTTupdates
				});
				
				latestRTTline.set("tickmarks", "circle");
				latestRTTline.set("ticksize", 4);
				latestRTTline.set("defaultcolor", ['#ff9900']);
				latestRTTline.set("xmin", settings.minX );
				latestRTTline.set("ymin", 0 );
				latestRTTline.set("xmax", smallMaxX );
				latestRTTline.set("ymax", rttMaxY );
				latestRTTline.set("line.colors", ['#ff9900']); // orange
				latestRTTline.set("line", true);
				latestRTTline.set("backgroundGrid", true);
				latestRTTline.set("scaleThousand", "");
				latestRTTline.set("xscale", false);// x-labels would be messed up otherwhise 
				lines.push(latestRTTline);
			}



			
			let plots = [...scatters, ...lines];
			
			let combo1graphs = [];
			let combo2graphs = [];

			for( let plot of plots ){
				if( plot.id.indexOf("2") >= 0 )
					combo2graphs.push( plot );
				else
					combo1graphs.push(plot);
			}
			
			combo1graphs[0].set("backgroundGrid", true);
			combo1graphs[0].set("textSize", 7 * scale);
			combo1graphs[0].set("backgroundGridWidth", 1 * scale);


			let combo = new RGraph.CombinedChart( combo1graphs );
			combo.draw();
			
			let combo2 = new RGraph.CombinedChart( combo2graphs );
			combo2.draw();
		}
	}