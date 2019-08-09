function getPropertyNameForVersion(draft0Name, version){
	if (version === "draft-00") {
		return draft0Name;
	} else if (version === "draft-01") {
		if (draft0Name === "EVENT_TYPE") {
			return "event";
		}
		return draft0Name.toLowerCase();
	} else {
		return "Unsupported conversion: version " + version + " is not supported by the tool";
	}
}

graphState = {
	eventBus: null, // A dummy DOM element which is used to fire off custom events
	/*
		Events:
			- packetSelectionEvent
			- packetPickEvent
	*/

	outerWidth: window.innerWidth * 0.8,
	outerHeight: 600,
	margins: {
		top: 20,
		bottom: 60,
		left: 70,
		right: 70,
	},
	innerWidth: -1,
	innerHeight: -1,

	chartSvg: null,
	canvas: null,
	canvasContext: null,
	mouseHandlerPanningSvg: null,
	mouseHandlerBrushXSvg: null,
	mouseHandlerBrush2dSvg: null,
	mouseHandlerSelectionSvg: null,
	mouseHandlerPickSvg: null,
	brushX: null,
	brushXElement: null,
	brush2d: null,
	brush2dElement: null,
	selectionBrush: null,
	packetInformationDiv: null,
	congestionGraphEnabled: true,

	xScale: null,
	yPacketScale: null, // Used for packet_sent, packet_acked and packet_lost
	yCongestionScale: null, // Used for congestion window and bytes in flight
	xAxis: null,
	yPacketAxis: null,
	yCongestionAxis: null,
	gxAxis: null,
	gyPacketAxis: null,
	gyCongestionAxis: null,
	rangeX: null, // [minX, maxX]
	packetRangeY: null, // [minY, maxY]
	congestionRangeY: null, // [minY, maxY]
	originalRangeX: null, // [minX, maxX]
	originalPacketRangeY: null, // [minY, maxY]
	originalCongestionRangeY: null, // [minY, maxY]

	drawScale: 1,

	events: {
		sent: null,
		lost: null,
	},
	lut:{
		sent: null,
		acked: null,
		lost: null,
	},
	scatters: {
		sent: null, // [x, y][]
		acked: null, // [x, y][]
		lost: null, // [x, y][]
	},
	congestionLines: {
		bytes: null, // [x, y][]
		cwnd: null, // [x, y][]
		minRTT: null, // [x, y][]
		smoothedRTT: null, // [x, y][]
		lastRTT: null, // [x, y][]
	}
};

recoveryGraphState = {
	outerWidth: window.innerWidth * 0.8,
	outerHeight: 300,
	margins: {
		top: 20,
		bottom: 60,
		left: 70,
		right: 70,
	},
	innerWidth: -1,
	innerHeight: -1,

	graphSvg: null,
	graphCanvas: null,
	graphCanvasContext: null,

	xAxis: null, // xScale is shared with main chart
	gxAxis: null,

	yScale: null,
	yAxis: null,
	gyAxis: null,
	originalRangeY: null, // [minY, maxY]
	rangeY: null,
}

function scalingFunction(x){
	return (1 / (1 + Math.exp(-(x - 2) ))) + 1.2;
}

function redrawCanvas(minX, maxX, minPacketY, maxPacketY){
	graphState.xScale = d3.scaleLinear()
		.domain([minX, maxX])
		.range([0, graphState.innerWidth])

	graphState.yPacketScale = d3.scaleLinear()
		.domain([minPacketY, maxPacketY])
		.range([graphState.innerHeight, 0])

	graphState.gxAxis.call(graphState.xAxis.scale(graphState.xScale));
	graphState.gyPacketAxis.call(graphState.yPacketAxis.scale(graphState.yPacketScale));
	recoveryGraphState.gxAxis.call(recoveryGraphState.xAxis.scale(graphState.xScale));

	graphState.drawScale = scalingFunction((graphState.originalRangeX[1] - graphState.originalRangeX[0]) / (maxX - minX));

	graphState.canvasContext.clearRect(0, 0, graphState.innerWidth, graphState.innerHeight);
	recoveryGraphState.graphCanvasContext.clearRect(0, 0, recoveryGraphState.innerWidth, recoveryGraphState.innerHeight);

	for (const event of graphState.scatters["sent"]) {
		const height = graphState.yPacketScale(event.to) - graphState.yPacketScale(event.from);
		drawRect(graphState.canvasContext, graphState.xScale(event.time), graphState.yPacketScale(event.to), (3 * graphState.drawScale), height, "#0000FF");
	}

	for (const event of graphState.scatters["acked"]) {
		const height = graphState.yPacketScale(event.to) - graphState.yPacketScale(event.from);
		drawRect(graphState.canvasContext, graphState.xScale(event.time), graphState.yPacketScale(event.to), (3 * graphState.drawScale), height, "#6B8E23");
	}

	for (const event of graphState.scatters["lost"]) {
		const height = graphState.yPacketScale(event.to) - graphState.yPacketScale(event.from);
		drawRect(graphState.canvasContext, graphState.xScale(event.time), graphState.yPacketScale(event.to), (3 * graphState.drawScale), height, "#FF0000");
	}

	if (graphState.congestionGraphEnabled) {
		drawLines(graphState.canvasContext, graphState.congestionLines["bytes"].map((point) => {
			return [ graphState.xScale(point[0]), graphState.yCongestionScale(point[1]) ];
		}), "#808000", drawCircle);

		drawLines(graphState.canvasContext, graphState.congestionLines["cwnd"].map((point) => {
			return [ graphState.xScale(point[0]), graphState.yCongestionScale(point[1]) ];
		}), "#8A2BE2", drawCross);
	}

	drawLines(recoveryGraphState.graphCanvasContext, graphState.congestionLines["minRTT"].map((point) => {
		return [ graphState.xScale(point[0]), recoveryGraphState.yScale(point[1]) ];
	}), "#C96480");

	drawLines(recoveryGraphState.graphCanvasContext, graphState.congestionLines["smoothedRTT"].map((point) => {
		return [ graphState.xScale(point[0]), recoveryGraphState.yScale(point[1]) ];
	}), "#8a554a");

	drawLines(recoveryGraphState.graphCanvasContext, graphState.congestionLines["lastRTT"].map((point) => {
		return [ graphState.xScale(point[0]), recoveryGraphState.yScale(point[1]) ];
	}), "#ff9900");

	graphState.rangeX = [minX, maxX];
	graphState.packetRangeY = [minPacketY, maxPacketY];
}

function findXExtrema(){
	let min = Infinity;
	let max = 0;
	for (const event of graphState.scatters["sent"]) {
		min = min > event.time ? event.time : min;
		max = max < event.time ? event.time : max;
	}

	for (const event of graphState.scatters["acked"]) {
		min = min > event.time ? event.time : min;
		max = max < event.time ? event.time : max;
	}

	for (const event of graphState.scatters["lost"]) {
		min = min > event.time ? event.time : min;
		max = max < event.time ? event.time : max;
	}
	return [min, max];
}

// Finds the min and max Y value in the scatters of graphState
// returns [min, max]
function findYExtrema(minX, maxX){
	let min = Infinity;
	let max = 0;
	for (const event of graphState.scatters["sent"]) {
		if (event.time >= minX && event.time <= maxX) {
			min = min > event.to ? event.to : min;
			max = max < event.to ? event.to : max;
		}
	}

	for (const event of graphState.scatters["acked"]) {
		if (event.time >= minX && event.time <= maxX) {
			min = min > event.to ? event.to : min;
			max = max < event.to ? event.to : max;
		}
	}

	for (const event of graphState.scatters["lost"]) {
		if (event.time >= minX && event.time <= maxX) {
			min = min > event.to ? event.to : min;
			max = max < event.to ? event.to : max;
		}
	}
	return [min, max];
}

function findCongestionYExtrema(){
	let min = Infinity;
	let max = 0;
	for (const point of graphState.congestionLines["bytes"]){
		min = min > point[1] ? point[1] : min;
		max = max < point[1] ? point[1] : max;
	}
	for (const point of graphState.congestionLines["cwnd"]){
		min = min > point[1] ? point[1] : min;
		max = max < point[1] ? point[1] : max;
	}
	return [min, max];
}

function findRecoveryYExtrema(){
	let min = Infinity;
	let max = 0;
	for (const point of graphState.congestionLines["minRTT"]){
		min = min > point[1] ? point[1] : min;
		max = max < point[1] ? point[1] : max;
	}
	for (const point of graphState.congestionLines["smoothedRTT"]){
		min = min > point[1] ? point[1] : min;
		max = max < point[1] ? point[1] : max;
	}
	for (const point of graphState.congestionLines["lastRTT"]){
		min = min > point[1] ? point[1] : min;
		max = max < point[1] ? point[1] : max;
	}
	return [min, max];
}

function findAckedPackets(ackFrom, ackTo){
	const packets = [];

	for (const packet of graphState.lut["sent"]){
		if (packet.from >= ackFrom && packet.to <= ackTo) {
			packets.push(packet);
		}
	}

	return packets;
}

function drawPoint(canvasContext, x, y, color){
	const radius = (3 * graphState.drawScale) / 2;
	canvasContext.beginPath();
	canvasContext.fillStyle = color;
	canvasContext.rect(x - radius, y + radius, radius * 2, radius * 2);
	canvasContext.fill();
}

// const height = height > 1 ? (height * graphState.drawScale) : (1 * graphState.drawScale); // Bound to a minimum
function drawRect(canvasContext, x, y, width, height, color){
	canvasContext.beginPath();
	canvasContext.fillStyle = color;
	canvasContext.rect(x, y, width * graphState.drawScale, -height * graphState.drawScale);
	canvasContext.fill();
}

function drawLines(canvasContext, pointList, color, tickDrawFunction){
	canvasContext.lineWidth = 1 * graphState.drawScale;
	if (pointList.length > 0) {
		canvasContext.beginPath();
		canvasContext.strokeStyle = color;
		const startX = pointList[0][0];
		const startY = pointList[0][1];
		canvasContext.moveTo(startX, startY);
		for (let i = 1; i < pointList.length; ++i) {
			const pointX = pointList[i][0];
			const pointY = pointList[i][1];
			canvasContext.lineTo(pointX, pointY);
		}
		canvasContext.stroke();
		for (let i = 1; i < pointList.length; ++i) {
			const pointX = pointList[i][0];
			const pointY = pointList[i][1];
			if (tickDrawFunction) {
				tickDrawFunction(canvasContext, pointX, pointY, color);
			}
		}
	}
}

function drawCross(canvasContext, centerX, centerY, color){
	const radius = 2;
	canvasContext.strokeStyle = color;
	// Top left to bottom right
	canvasContext.beginPath();
	canvasContext.moveTo(centerX - radius, centerY - radius);
	canvasContext.lineTo(centerX + radius, centerY + radius);
	canvasContext.stroke();

	// Top right to bottom left
	canvasContext.beginPath();
	canvasContext.moveTo(centerX + radius, centerY - radius);
	canvasContext.lineTo(centerX - radius, centerY + radius);
	canvasContext.stroke();
}

function drawCircle(canvasContext, centerX, centerY, color){
	const radius = 2;
	canvasContext.fillStyle = color;

	canvasContext.beginPath();
	canvasContext.arc(centerX, centerY, radius, 0, 360);
	canvasContext.fill();
}

function resetZoom(){
	graphState.rangeX = graphState.originalRangeX;
	graphState.packetRangeY = graphState.originalPacketRangeY;

	redrawCanvas(graphState.rangeX[0], graphState.rangeX[1], graphState.packetRangeY[0], graphState.packetRangeY[1]);
}

function onBrushXEnd(){
	const selection = d3.event.selection;

	// Convert screen-space coordinates to graph coords
	const dragStartX = graphState.xScale.invert(selection[0]);
	const dragStopX = graphState.xScale.invert(selection[1]);

	// New dimensions
	const [minX, maxX] = dragStartX < dragStopX ? [dragStartX, dragStopX] : [dragStopX, dragStartX];
	const [minY, maxY] = findYExtrema(minX, maxX);

	redrawCanvas(minX, maxX, minY, maxY);

	graphState.mouseHandlerBrushXSvg.call(graphState.brushX, null); // Clear brush highlight
	usePanning(); // Switch back to panning mode
}

function onBrush2dEnd(){
	const selection = d3.event.selection;

	// Convert screen-space coordinates to graph coords
	const dragStartX = graphState.xScale.invert(selection[0][0]);
	const dragStopX = graphState.xScale.invert(selection[1][0]);
	const dragStartY = graphState.yPacketScale.invert(selection[0][1]);
	const dragStopY = graphState.yPacketScale.invert(selection[1][1]);

	// New dimensions
	const [minX, maxX] = dragStartX < dragStopX ? [dragStartX, dragStopX] : [dragStopX, dragStartX];
	const [minY, maxY] = dragStartY < dragStopY ? [dragStartY, dragStopY] : [dragStopY, dragStartY];

	redrawCanvas(minX, maxX, minY, maxY);

	graphState.mouseHandlerBrush2dSvg.call(graphState.brush2d, null); // Clear brush highlight
	usePanning(); // Switch back to panning mode
}

function onSelection(){
	const selection = d3.event.selection;
	graphState.mouseHandlerSelectionSvg.call(graphState.selectionBrush, null); // Clear brush highlight

	// Convert screen-space coordinates to graph coords
	const dragStartX = graphState.xScale.invert(selection[0][0]);
	const dragStopX = graphState.xScale.invert(selection[1][0]);
	const dragStartY = graphState.yPacketScale.invert(selection[0][1]);
	const dragStopY = graphState.yPacketScale.invert(selection[1][1]);

	graphState.eventBus.dispatchEvent(new CustomEvent('packetSelectionEvent', {
		detail: {
			dragStartX,
			dragStopX,
			dragStartY,
			dragStopY,
		},
	}));
}

function onPickerClick(){
	const svgClickCoords = d3.mouse(this);
	const graphCoords = [graphState.xScale.invert(svgClickCoords[0]), graphState.yPacketScale.invert(svgClickCoords[1])];

	const pixelData = graphState.canvasContext.getImageData(svgClickCoords[0], svgClickCoords[1], 1, 1).data;
	const pixelColor = [ pixelData[0], pixelData[1], pixelData[2] ];

	graphState.eventBus.dispatchEvent(new CustomEvent('packetPickEvent', {
		detail: {
			x: graphCoords[0],
			y: graphCoords[1],
			pixelColor: pixelColor,
		},
	}));
}

function onHover(){
	// Clear all ackarrows
	graphState.chartSvg.selectAll(".ackArrow").remove();

	if (d3.event.buttons !== 0) {
		graphState.packetInformationDiv.style("display", "none");
		return;
	}

	const svgHoverCoords = d3.mouse(this);
	const graphCoords = [graphState.xScale.invert(svgHoverCoords[0]), graphState.yPacketScale.invert(svgHoverCoords[1])];

	const pixelData = graphState.canvasContext.getImageData(svgHoverCoords[0], svgHoverCoords[1], 1, 1).data;
	const pixelColor = [ pixelData[0], pixelData[1], pixelData[2] ];

	if (pixelColor[0] === 0 && pixelColor[1] === 0 && pixelColor[2] === 255 ) {
		// sent
		for (const packet of graphState.events.sent) {
			if (packet.timestamp >= graphCoords[0] - 1.5 && packet.timestamp <= graphCoords[0] + 1.5) {
				graphState.packetInformationDiv.style("display", "block");
				graphState.packetInformationDiv.style("left", (svgHoverCoords[0] + graphState.margins.left - 50 + 10) + "px");
				graphState.packetInformationDiv.style("top", (svgHoverCoords[1] + graphState.margins.top + 10) + "px");
				graphState.packetInformationDiv.select("#timestamp").text("Timestamp: " + packet.timestamp);
				graphState.packetInformationDiv.select("#packetNr").text("PacketNr: " + packet.details.header.packet_number);
				graphState.packetInformationDiv.select("#packetSize").text("PacketSize: " + packet.details.header.packet_size);
				return;
			}
		}
	} else if (pixelColor[0] === 107 && pixelColor[1] === 142 && pixelColor[2] === 35 ) {
		// acked
		for (const packet of graphState.lut["acked"]) {
			if (packet.time >= graphCoords[0] - 1.5 && packet.time <= graphCoords[0] + 1.5 && packet.from <= graphCoords[1] && packet.to >= graphCoords[1]) {
				graphState.packetInformationDiv.style("display", "block");
				graphState.packetInformationDiv.style("left", (svgHoverCoords[0] + graphState.margins.left - 50 + 10) + "px");
				graphState.packetInformationDiv.style("top", (svgHoverCoords[1] + graphState.margins.top + 10) + "px");
				graphState.packetInformationDiv.select("#timestamp").text("Timestamp: " + packet.time);
				graphState.packetInformationDiv.select("#ackedFrom").text("Acked from: " + packet.from);
				graphState.packetInformationDiv.select("#ackedTo").text("Acked to: " + packet.to);

				const correspondingPackets = findAckedPackets(packet.from, packet.to);

				for (const correspondingPacket of correspondingPackets) {
					const packetX = graphState.xScale(correspondingPacket.time);
					const yCenter = ((correspondingPacket.to - correspondingPacket.from) / 2) + correspondingPacket.from;
					const packetY = graphState.yPacketScale(yCenter);

					graphState.chartSvg
						.append("line")
						.attr("class", "ackArrow")
						.attr("x1", svgHoverCoords[0])
						.attr("x2", packetX > 0 ? packetX : 0)
						.attr("y1", packetY)
						.attr("y2", packetY)
						.attr("stroke-width", "2px")
						.attr("stroke", "#8d8369");
				}

				return;
			}
		}
	} else if (pixelColor[0] === 255 && pixelColor[1] === 0 && pixelColor[2] === 0 ) {
		// lost
		for (const packet of graphState.events.lost) {
			if (packet.timestamp >= graphCoords[0] - 1.5 && packet.timestamp <= graphCoords[0] + 1.5) {
				graphState.packetInformationDiv.style("display", "block");
				graphState.packetInformationDiv.style("left", (svgHoverCoords[0] + graphState.margins.left - 50 + 10) + "px");
				graphState.packetInformationDiv.style("top", (svgHoverCoords[1] + graphState.margins.top + 10) + "px");
				graphState.packetInformationDiv.select("#timestamp").text("Timestamp: " + packet.timestamp);
				graphState.packetInformationDiv.select("#packetNr").text("PacketNr: " + packet.details.header.packet_number);
				graphState.packetInformationDiv.select("#packetSize").text("PacketSize: " + packet.details.header.packet_size);
				return;
			}
		}
	} else {
		// No event found
		graphState.packetInformationDiv.style("display", "none");
		graphState.packetInformationDiv.select("#timestamp").text("");
		graphState.packetInformationDiv.select("#packetNr").text("");
		graphState.packetInformationDiv.select("#packetSize").text("");
		graphState.packetInformationDiv.select("#ackedFrom").text("");
		graphState.packetInformationDiv.select("#ackedTo").text("");
		graphState.chartSvg.selectAll(".ackArrow").remove();
	}
}

function onZoom(){
	d3.event.preventDefault();
	const zoomFactor = d3.event.deltaY > 0 ? 1 / 1.5 : 1.5;

	const mouseX = graphState.xScale.invert(d3.mouse(this)[0]);
	// const mouseY = graphState.yPacketScale.invert(d3.mouse(this)[1]);

	const leftX = graphState.rangeX[0];
	const rightX = graphState.rangeX[1];
	// const topY = graphState.packetRangeY[0];
	// const bottomY = graphState.packetRangeY[1];

	const zoomedLeftPortion = ((mouseX - leftX) / zoomFactor);
	const zoomedRightPortion = ((rightX - mouseX) / zoomFactor);
	// const zoomedTopPortion = ((mouseY - topY) / zoomFactor);
	// const zoomedBottomPortion = ((bottomY - mouseY) / zoomFactor);

	// Cap at full fit
	const newLeftX = mouseX - zoomedLeftPortion >= 0 ? mouseX - zoomedLeftPortion : 0;
	const newRightX = mouseX + zoomedRightPortion <= graphState.originalRangeX[1] ? mouseX + zoomedRightPortion : graphState.originalRangeX[1];
	// const newTopY = mouseY - zoomedTopPortion >= 0 ? mouseY - zoomedTopPortion : 0;
	// const newBottomY = mouseY + zoomedBottomPortion <= graphState.originalPacketRangeY[1] ? mouseY + zoomedBottomPortion : graphState.originalPacketRangeY[1];
	const [newTopY, newBottomY] = findYExtrema(newLeftX, newRightX);

	redrawCanvas(newLeftX, newRightX, newTopY, newBottomY);
}

function panCanvas(deltaX, deltaY){
	// Check if pan stays within boundaries
	// If not, set the delta to snap to boundary instead of passing it
	if (graphState.rangeX[0] + deltaX < 0) {
		deltaX = 0 - graphState.rangeX[0];
	} else if (graphState.rangeX[1] + deltaX > graphState.originalRangeX[1]) {
		deltaX = graphState.originalRangeX[1] - graphState.rangeX[1];
	}
	if (graphState.packetRangeY[0] + deltaY < 0) {
		deltaY = 0 - graphState.packetRangeY[0];
	} else if (graphState.packetRangeY[1] + deltaY > graphState.originalPacketRangeY[1]) {
		deltaY = graphState.originalPacketRangeY[1] - graphState.packetRangeY[1];
	}

	const newLeftX =  graphState.rangeX[0] + deltaX;
	const newRightX = graphState.rangeX[1] + deltaX;

	const newTopY = graphState.packetRangeY[0] + deltaY;
	const newBottomY =  graphState.packetRangeY[1] + deltaY;

	redrawCanvas(newLeftX, newRightX, newTopY, newBottomY);
}

let previousX = null;
let previousY = null;

function onPan(){
	if (d3.event.buttons & 1) { // Primary button pressed and moving
		const graphX = graphState.xScale.invert(d3.mouse(this)[0]);
		const graphY = graphState.yPacketScale.invert(d3.mouse(this)[1]);

		// If not yet set, set them for next event
		if (previousX === null || previousY === null) {
			previousX = graphX;
			previousY = graphY;
			return;
		}

		const panAmountX = (graphState.rangeX[1] - graphState.rangeX[0]) / graphState.innerWidth;
		const panAmountY = (graphState.packetRangeY[1] - graphState.packetRangeY[0]) / graphState.innerHeight;

		let deltaX = d3.event.movementX * panAmountX * -1;// graphX - previousX;
		let deltaY = d3.event.movementY * panAmountY;// graphY - previousY;

		panCanvas(deltaX, deltaY);

		previousX = graphX;
		previousY = graphY;
	}
}

function useBrushX(){
	graphState.mouseHandlerBrush2dSvg.style('z-index', 0);
	graphState.mouseHandlerBrushXSvg.style('z-index', 1);
	graphState.mouseHandlerPanningSvg.style('z-index', 0);
	graphState.mouseHandlerSelectionSvg.style('z-index', 0);
	graphState.mouseHandlerPickSvg.style('z-index', 0);
}

function useBrush2d(){
	graphState.mouseHandlerBrush2dSvg.style('z-index', 1);
	graphState.mouseHandlerBrushXSvg.style('z-index', 0);
	graphState.mouseHandlerPanningSvg.style('z-index', 0);
	graphState.mouseHandlerSelectionSvg.style('z-index', 0);
	graphState.mouseHandlerPickSvg.style('z-index', 0);
}

function usePanning(){
	graphState.mouseHandlerBrush2dSvg.style('z-index', 0);
	graphState.mouseHandlerBrushXSvg.style('z-index', 0);
	graphState.mouseHandlerPanningSvg.style('z-index', 1);
	graphState.mouseHandlerSelectionSvg.style('z-index', 0);
	graphState.mouseHandlerPickSvg.style('z-index', 0);
}

function useSelection(){
	graphState.mouseHandlerBrush2dSvg.style('z-index', 0);
	graphState.mouseHandlerBrushXSvg.style('z-index', 0);
	graphState.mouseHandlerPanningSvg.style('z-index', 0);
	graphState.mouseHandlerSelectionSvg.style('z-index', 1);
	graphState.mouseHandlerPickSvg.style('z-index', 0);
}

function usePicker(){
	graphState.mouseHandlerBrush2dSvg.style('z-index', 0);
	graphState.mouseHandlerBrushXSvg.style('z-index', 0);
	graphState.mouseHandlerPanningSvg.style('z-index', 0);
	graphState.mouseHandlerSelectionSvg.style('z-index', 0);
	graphState.mouseHandlerPickSvg.style('z-index', 1);
}

function toggleCongestionGraph(){
	graphState.congestionGraphEnabled = graphState.congestionGraphEnabled ? false : true;

	redrawCanvas(graphState.rangeX[0], graphState.rangeX[1], graphState.packetRangeY[0], graphState.packetRangeY[1]);
}

function drawGraphd3( qlog, settings ){
	console.log("Drawing graph with d3...", qlog, settings);

	graphState.eventBus = document.createElement("span");
	graphState.eventBus.addEventListener('packetSelectionEvent', (e) => {
		console.log("event: ", e.detail);
	});
	graphState.eventBus.addEventListener('packetPickEvent', (e) => {
		console.log("event: ", e.detail);
	});

	graphState.qlog = qlog;

	graphState.innerWidth = graphState.outerWidth - graphState.margins.left - graphState.margins.right;
	graphState.innerHeight = graphState.outerHeight - graphState.margins.top - graphState.margins.bottom,

	recoveryGraphState.innerWidth = recoveryGraphState.outerWidth - recoveryGraphState.margins.left - recoveryGraphState.margins.right;
	recoveryGraphState.innerHeight = recoveryGraphState.outerHeight - recoveryGraphState.margins.top - recoveryGraphState.margins.bottom;

	// Give a set height to the container so its children can fit inside
	d3.select("#graphContainer").style("height", graphState.outerHeight + "px");
	d3.select("#recoveryGraphContainer").style("height", recoveryGraphState.outerHeight + "px");

	graphState .packetInformationDiv = d3.select("#packetInfo");

	graphState.chartSvg = d3.select("#graphContainer")
		.append('svg:svg')
		.attr('width', graphState.outerWidth)
		.attr('height', graphState.outerHeight)
		.style('position', "absolute")
		.append('g')
		.attr('transform', 'translate(' + graphState.margins.left + ', ' + graphState.margins.top + ')');

	graphState.canvas = d3.select("#graphContainer")
		.append('canvas')
		.attr('width', graphState.innerWidth)
		.attr('height', graphState.innerHeight)
		.style('margin-left', graphState.margins.left + "px")
		.style('margin-top', graphState.margins.top + "px")
		.style('position', "absolute");

	graphState.mouseHandlerPanningSvg = d3.select("#graphContainer")
		.append('svg:svg')
		.attr('width', graphState.innerWidth)
		.attr('height', graphState.innerHeight)
		.style('margin-left', graphState.margins.left + "px")
		.style('margin-top', graphState.margins.top + "px")
		.style('z-index', 1) // Enabled by default
		.style('position', "absolute");

	graphState.mouseHandlerBrushXSvg = d3.select("#graphContainer")
		.append('svg:svg')
		.attr('width', graphState.innerWidth)
		.attr('height', graphState.innerHeight)
		.style('margin-left', graphState.margins.left + "px")
		.style('margin-top', graphState.margins.top + "px")
		.style('z-index', 0) // Disabled by default
		.style('position', "absolute");

	graphState.mouseHandlerBrush2dSvg = d3.select("#graphContainer")
		.append('svg:svg')
		.attr('width', graphState.innerWidth)
		.attr('height', graphState.innerHeight)
		.style('margin-left', graphState.margins.left + "px")
		.style('margin-top', graphState.margins.top + "px")
		.style('z-index', 0) // Disabled by default
		.style('position', "absolute");

	graphState.mouseHandlerSelectionSvg = d3.select("#graphContainer")
		.append('svg:svg')
		.attr('width', graphState.innerWidth)
		.attr('height', graphState.innerHeight)
		.style('margin-left', graphState.margins.left + "px")
		.style('margin-top', graphState.margins.top + "px")
		.style('z-index', 0) // Disabled by default
		.style('position', "absolute");

	graphState.mouseHandlerPickSvg = d3.select("#graphContainer")
		.append('svg:svg')
		.attr('width', graphState.innerWidth)
		.attr('height', graphState.innerHeight)
		.style('margin-left', graphState.margins.left + "px")
		.style('margin-top', graphState.margins.top + "px")
		.style('z-index', 0) // Disabled by default
		.style('position', "absolute");

	recoveryGraphState.graphSvg = d3.select("#recoveryGraphContainer")
		.append('svg:svg')
		.attr('width', recoveryGraphState.outerWidth)
		.attr('height', recoveryGraphState.outerHeight)
		.style('position', "absolute")
		.append('g')
		.attr('transform', 'translate(' + recoveryGraphState.margins.left + ', ' + recoveryGraphState.margins.top + ')');

	recoveryGraphState.graphCanvas = d3.select("#recoveryGraphContainer")
		.append('canvas')
		.attr('width', recoveryGraphState.innerWidth)
		.attr('height', recoveryGraphState.innerHeight)
		.style('margin-left', recoveryGraphState.margins.left + "px")
		.style('margin-top', recoveryGraphState.margins.top + "px")
		.style('position', "absolute");

	graphState.canvasContext = graphState.canvas.node().getContext('2d');
	recoveryGraphState.graphCanvasContext = recoveryGraphState.graphCanvas.node().getContext('2d');

	// -----------------------------------

	// Parses qlog and fills graphState.events, graphState.scatters and graphState.lut
	parseData(qlog, settings);

	const [globalXMin, globalXMax] = findXExtrema();
	const [localXMin, localXMax] = [settings.minX && settings.minX > globalXMin ? settings.minX : globalXMin, settings.maxX && settings.maxX < globalXMax ? settings.maxX : globalXMax];
	const [localMinPacketY, localMaxPacketY] = findYExtrema(settings.minX, settings.maxX);
	const [globalMinPacketY, globalMaxPacketY] = findYExtrema(globalXMin, globalXMax);
	let [minCongestionY, maxCongestionY] = findCongestionYExtrema();
	maxCongestionY *= 3; // Make the congestion graph take up only 1/3 of the vertical screen space
	const [minRecoveryY, maxRecoveryY] = findRecoveryYExtrema();

	graphState.xScale = d3.scaleLinear()
		.domain([localXMin, localXMax])
		.range([0, graphState.innerWidth]);

	graphState.yPacketScale = d3.scaleLinear()
		.domain([localMinPacketY, localMaxPacketY])
		.range([graphState.innerHeight, 0]);

	graphState.yCongestionScale = d3.scaleLinear()
		.domain([0, maxCongestionY])
		.range([graphState.innerHeight, 0])
		.nice();

	recoveryGraphState.yScale = d3.scaleLinear()
		.domain([minRecoveryY, maxRecoveryY])
		.range([recoveryGraphState.innerHeight, 0]);

	graphState.xAxis = d3.axisBottom(graphState.xScale)
		.tickSize(-graphState.innerHeight)
		.scale(graphState.xScale);

	graphState.yPacketAxis = d3.axisLeft(graphState.yPacketScale)
		.tickFormat( (num, i) => {
			if( num > 1000 || num < -1000){
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
		})
		.tickSize(-graphState.innerWidth)
		.scale(graphState.yPacketScale)

	graphState.yCongestionAxis = d3.axisRight(graphState.yCongestionScale)
		.tickFormat( (num, i) => {
			if( num > 1000 || num < -1000){
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
		})
		.tickSize(graphState.innerWidth)
		.scale(graphState.yCongestionScale)

	recoveryGraphState.xAxis = d3.axisBottom(graphState.xScale)
		.tickSize(-recoveryGraphState.innerHeight)
		.scale(graphState.xScale);

	recoveryGraphState.yAxis = d3.axisLeft(recoveryGraphState.yScale)
		.tickSize(-recoveryGraphState.innerWidth)
		.scale(recoveryGraphState.yScale);

	graphState.gxAxis = graphState.chartSvg.append('g')
		.attr('transform', 'translate(0, ' + graphState.innerHeight + ')')
		.attr("class", "grid")
		.call(graphState.xAxis);

	graphState.gyPacketAxis = graphState.chartSvg.append('g')
		.attr("class", "grid")
		.call(graphState.yPacketAxis);

	graphState.gyCongestionAxis = graphState.chartSvg.append('g')
		.attr("class", "nogrid")
		.call(graphState.yCongestionAxis);

	recoveryGraphState.gxAxis = recoveryGraphState.graphSvg.append('g')
		.attr('transform', 'translate(0, ' + recoveryGraphState.innerHeight + ')')
		.attr("class", "grid")
		.call(recoveryGraphState.xAxis);

	recoveryGraphState.gyAxis = recoveryGraphState.graphSvg.append('g')
		.attr("class", "grid")
		.call(recoveryGraphState.yAxis);

	// Packet axis
	graphState.chartSvg.append('text')
		.attr('x', '-' + (graphState.innerHeight / 2))
		.attr('dy', '-3.5em')
		.attr('transform', 'rotate(-90)')
		.text('Data sent (bytes)');

	// X axis
	graphState.chartSvg.append('text')
		.attr('x', '' + (graphState.innerWidth / 2))
		.attr('y', '' + (graphState.innerHeight + 40))
		.text('Time (ms)');

	// Congestion axis
	graphState.chartSvg.append('text')
		.attr('transform', 'translate(' + (graphState.innerWidth + graphState.margins.right) + ', ' + graphState.innerHeight / 2 + '), rotate(-90)')
		.text('Congestion info (bytes)');

	// Recovery x axis
	recoveryGraphState.graphSvg.append('text')
		.attr('x', '' + (recoveryGraphState.innerWidth / 2))
		.attr('y', '' + (recoveryGraphState.innerHeight + 40))
		.text('Time (ms)');

	// Recovery y axis
	recoveryGraphState.graphSvg.append('text')
		.attr('x', '-' + (recoveryGraphState.innerHeight / 2))
		.attr('dy', '-3.5em')
		.attr('transform', 'rotate(-90)')
		.text('RTT (ms)');

	graphState.originalRangeX = [globalXMin, globalXMax];
	graphState.rangeX = [localXMin, localXMax];
	graphState.originalPacketRangeY = [globalMinPacketY, globalMaxPacketY];
	graphState.packetRangeY = [localMinPacketY, localMaxPacketY];
	graphState.originalCongestionRangeY = [minCongestionY, maxCongestionY];
	graphState.congestionRangeY = graphState.originalCongestionRangeY;
	recoveryGraphState.originalRangeY = [minRecoveryY, maxRecoveryY];
	recoveryGraphState.rangeY = recoveryGraphState.originalRangeY;

	redrawCanvas(graphState.rangeX[0], graphState.rangeX[1], graphState.packetRangeY[0], graphState.packetRangeY[1]);

	graphState.mouseHandlerPanningSvg.on("wheel", onZoom)
		.on("click", onPickerClick)
		.on("mousemove.pan", onPan)
		.on("mousemove.hover", onHover);

	graphState.mouseHandlerPickSvg.on("wheel", onZoom)
		.on("click", onPickerClick)
		.on("mousemove", onHover);

	graphState.brushX = d3.brushX()
		.extent([[0, 0], [graphState.innerWidth, graphState.innerHeight]])
		.on("end", onBrushXEnd);

	graphState.brushXElement = graphState.mouseHandlerBrushXSvg
		.append("g")
		.attr("class", "brush")
		.call(graphState.brushX)
		.on("wheel", onZoom)
		.on("mousemove", onHover);

	graphState.brush2d = d3.brush()
		.extent([[0, 0], [graphState.innerWidth, graphState.innerHeight]])
		.on("end", onBrush2dEnd);

	graphState.brush2dElement = graphState.mouseHandlerBrush2dSvg
		.append("g")
		.attr("class", "brush")
		.call(graphState.brush2d)
		.on("wheel", onZoom)
		.on("mousemove", onHover);

	graphState.selectionBrush = d3.brush()
		.extent([[0, 0], [graphState.innerWidth, graphState.innerHeight]])
		.on("end", onSelection);

	graphState.mouseHandlerSelectionSvg
		.append("g")
		.attr("class", "brush")
		.call(graphState.selectionBrush)
		.on("wheel", onZoom)
		.on("mousemove", onHover);

	d3.select("#graphContainer").style("display", "block");
	d3.select("#recoveryGraphContainer").style("display", "block");
}

// Returns [minX, maxX, minY, maxY, packetsSentScatterData, packetsAckedScatterData, packetsLostScatterData, bytesUpdates, cwndupdates, minRTTupdates, smoothedRTTupdates, lastRTTupdates]
function parseData(qlog, settings){
	let logSet = qlog;

	let multistreamDictionary = new Map();

	let xCap = 99999999999;
	let maxTimestamp = xCap;
	let minTimestamp = 0;

	let smallMaxX = 0;
	let smallMaxY = 0;
	let largeMaxX = 0;

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
		startTime = parseFloat(logSet.traces[0].events[0][fieldIndices.timestamp]);
		subtractTime = startTime;
	}

	fieldIndices.category 	= logSet.traces[0].event_fields.indexOf(getPropertyNameForVersion("CATEGORY", logSet["qlog_version"])); // typically 1
	fieldIndices.event 		= logSet.traces[0].event_fields.indexOf(getPropertyNameForVersion("EVENT_TYPE", logSet["qlog_version"])); // typically 2
	fieldIndices.trigger 	= logSet.traces[0].event_fields.indexOf(getPropertyNameForVersion("TRIGGER", logSet["qlog_version"])); // typically 3
	fieldIndices.data 		= logSet.traces[0].event_fields.indexOf(getPropertyNameForVersion("DATA", logSet["qlog_version"])); // typically 4

	// default time is assumed to be ms. qlog time can also be in microseconds (us)
	let timeMultiplier = 1;
	if( logSet.traces[0].configuration && logSet.traces[0].configuration.time_units && logSet.traces[0].configuration.time_units == "us" ){
		timeMultiplier = 0.001;
	}


	for( let evt of logSet.traces[0].events ){
		addToDictionary( fieldIndices, timeMultiplier, subtractTime * timeMultiplier, multistreamDictionary, evt );
	}


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
	if (multistreamDictionary.has(getPropertyNameForVersion("TRANSPORT", logSet["qlog_version"])) && multistreamDictionary.get(getPropertyNameForVersion("TRANSPORT", logSet["qlog_version"])).has(getPropertyNameForVersion("PACKET_SENT", logSet["qlog_version"]))) {
		packetsSent = multistreamDictionary.get(getPropertyNameForVersion("TRANSPORT", logSet["qlog_version"])).get(getPropertyNameForVersion("PACKET_SENT", logSet["qlog_version"]));
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
	if (multistreamDictionary.has(getPropertyNameForVersion("TRANSPORT", logSet["qlog_version"])) && multistreamDictionary.get(getPropertyNameForVersion("TRANSPORT", logSet["qlog_version"])).has(getPropertyNameForVersion("PACKET_RECEIVED", logSet["qlog_version"]))) {
		packetsReceived = multistreamDictionary.get(getPropertyNameForVersion("TRANSPORT", logSet["qlog_version"])).get(getPropertyNameForVersion("PACKET_RECEIVED", logSet["qlog_version"]));
	}

	for( let packet of packetsReceived ){

		let data = packet.details;

		if( !data.frames )
			continue;

		let ackFrames = [];
		for( let frame of data.frames ){
			if( frame.frame_type == getPropertyNameForVersion("ACK", logSet["qlog_version"]) )
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
	if (multistreamDictionary.has(getPropertyNameForVersion("RECOVERY", logSet["qlog_version"])) && multistreamDictionary.get(getPropertyNameForVersion("RECOVERY", logSet["qlog_version"])).has(getPropertyNameForVersion("PACKET_LOST", logSet["qlog_version"]))) {
		packetsLost = multistreamDictionary.get(getPropertyNameForVersion("RECOVERY", logSet["qlog_version"])).get(getPropertyNameForVersion("PACKET_LOST", logSet["qlog_version"])) || []; // || [] defaults to an empty array if there are no events of that type present in the log
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

	////////////
	//////////////
	/////////////////

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

	graphState.scatters["sent"] = packetsSentSizeLUT;

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

	graphState.scatters["acked"] = packetsAckedSizeLUT;

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

	graphState.scatters["lost"] = packetsLostSizeLUT;

	smallMaxX = Math.min( smallMaxX, xCap );

	smallMaxX = smallMaxX + ( Math.floor(smallMaxX * 0.01)); // add 5% of breathing space to the graph
	smallMaxY = smallMaxY + ( Math.floor(smallMaxY * 0.01)); // add 5% of breathing space to the graph

	smallMaxX = Math.ceil( smallMaxX / 50 ) * 50;// round to the nearest number divisble by 50
	smallMaxY = Math.ceil( smallMaxY / 5000 ) * 5000;// round to the nearest number divisble by 5000

	largeMaxX = smallMaxX;

	// ------------------------------------------------
	// ------------------------------------------------
	// ------------------------------------------------

	let lines = [];

	let metricUpdates = [];
	if (multistreamDictionary.has(getPropertyNameForVersion("RECOVERY", logSet["qlog_version"])) && multistreamDictionary.get(getPropertyNameForVersion("RECOVERY", logSet["qlog_version"])).has(getPropertyNameForVersion("METRIC_UPDATE", logSet["qlog_version"]))) {
		metricUpdates = multistreamDictionary.get(getPropertyNameForVersion("RECOVERY", logSet["qlog_version"])).get(getPropertyNameForVersion("METRIC_UPDATE", logSet["qlog_version"]));
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

	graphState.events.sent = packetsSent;
	graphState.events.lost = packetsLost;

	graphState.lut.sent = packetsSentSizeLUT;
	graphState.lut.acked = packetsAckedSizeLUT;
	graphState.lut.lost = packetsLostSizeLUT;

	graphState.congestionLines['bytes'] = bytesUpdates;
	graphState.congestionLines['cwnd'] = cwndupdates;
	graphState.congestionLines['minRTT'] = minRTTupdates;
	graphState.congestionLines['smoothedRTT'] = smoothedRTTupdates;
	graphState.congestionLines['lastRTT'] = lastRTTupdates;

	return [settings.minX, smallMaxX, 0, smallMaxY];
}

// we will add the qlog events to a separate dictionary for easy filtering and grouping of events
function addToDictionary( fieldIndices, timeMultiplier, subtractTime, dictionary, evt ){

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

	const [multistreamDictionary, timeMultiplier, packetSentList, packetAckedList, packetLostList] = parseData(qlog);

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
	if (multistreamDictionary.has(getPropertyNameForVersion("RECOVERY", logSet["qlog_version"])) && multistreamDictionary.get(getPropertyNameForVersion("RECOVERY", logSet["qlog_version"])).has(getPropertyNameForVersion("METRIC_UPDATE", logSet["qlog_version"]))) {
		metricUpdates = multistreamDictionary.get(getPropertyNameForVersion("RECOVERY", logSet["qlog_version"])).get(getPropertyNameForVersion("METRIC_UPDATE", logSet["qlog_version"]));
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
