let quictraceProto = {
  "nested": {
    "quic_trace": {
      "nested": {
        "FrameType": {
          "values": {
            "UNKNOWN_FRAME": 0,
            "STREAM": 1,
            "ACK": 2,
            "RESET_STREAM": 3,
            "CONNECTION_CLOSE": 4,
            "MAX_DATA": 5,
            "MAX_STREAM_DATA": 6,
            "PING": 7,
            "BLOCKED": 8,
            "STREAM_BLOCKED": 9,
            "PADDING": 10
          }
        },
        "StreamFrameInfo": {
          "fields": {
            "streamId": {
              "type": "uint64",
              "id": 1
            },
            "fin": {
              "type": "bool",
              "id": 2
            },
            "length": {
              "type": "uint64",
              "id": 3
            },
            "offset": {
              "type": "uint64",
              "id": 4
            }
          }
        },
        "AckBlock": {
          "fields": {
            "firstPacket": {
              "type": "uint64",
              "id": 1
            },
            "lastPacket": {
              "type": "uint64",
              "id": 2
            }
          }
        },
        "AckInfo": {
          "fields": {
            "ackedPackets": {
              "rule": "repeated",
              "type": "AckBlock",
              "id": 1
            },
            "ackDelayUs": {
              "type": "uint64",
              "id": 2
            }
          }
        },
        "ResetStreamInfo": {
          "fields": {
            "streamId": {
              "type": "uint64",
              "id": 1
            },
            "applicationErrorCode": {
              "type": "uint32",
              "id": 2
            },
            "finalOffset": {
              "type": "uint64",
              "id": 3
            }
          }
        },
        "CloseInfo": {
          "fields": {
            "errorCode": {
              "type": "uint32",
              "id": 1
            },
            "reasonPhrase": {
              "type": "string",
              "id": 2
            }
          }
        },
        "FlowControlInfo": {
          "fields": {
            "maxData": {
              "type": "uint64",
              "id": 1
            },
            "streamId": {
              "type": "uint64",
              "id": 2
            }
          }
        },
        "Frame": {
          "fields": {
            "frameType": {
              "type": "FrameType",
              "id": 1
            },
            "streamFrameInfo": {
              "type": "StreamFrameInfo",
              "id": 2
            },
            "ackInfo": {
              "type": "AckInfo",
              "id": 3
            },
            "resetStreamInfo": {
              "type": "ResetStreamInfo",
              "id": 4
            },
            "closeInfo": {
              "type": "CloseInfo",
              "id": 5
            },
            "flowControlInfo": {
              "type": "FlowControlInfo",
              "id": 6
            }
          }
        },
        "TransportState": {
          "fields": {
            "minRttUs": {
              "type": "uint64",
              "id": 1
            },
            "smoothedRttUs": {
              "type": "uint64",
              "id": 2
            },
            "lastRttUs": {
              "type": "uint64",
              "id": 3
            },
            "inFlightBytes": {
              "type": "uint64",
              "id": 4
            },
            "cwndBytes": {
              "type": "uint64",
              "id": 5
            },
            "pacingRateBps": {
              "type": "uint64",
              "id": 6
            },
            "congestionControlState": {
              "type": "string",
              "id": 7
            }
          }
        },
        "ExternalNetworkParameters": {
          "fields": {
            "bandwidthBps": {
              "type": "uint64",
              "id": 1
            },
            "rttUs": {
              "type": "uint64",
              "id": 2
            },
            "cwndBytes": {
              "type": "uint64",
              "id": 3
            }
          }
        },
        "EncryptionLevel": {
          "values": {
            "ENCRYPTION_UNKNOWN": 0,
            "ENCRYPTION_INITIAL": 1,
            "ENCRYPTION_0RTT": 2,
            "ENCRYPTION_1RTT": 3
          }
        },
        "EventType": {
          "values": {
            "UNKNOWN_EVENT": 0,
            "PACKET_SENT": 1,
            "PACKET_RECEIVED": 2,
            "PACKET_LOST": 3,
            "APPLICATION_LIMITED": 4,
            "EXTERNAL_PARAMETERS": 5
          }
        },
        "TransmissionReason": {
          "values": {
            "NORMAL_TRANSMISSION": 0,
            "TAIL_LOSS_PROBE": 1,
            "RTO_TRANSMISSION": 2,
            "PROBING_TRANSMISSION": 3
          }
        },
        "Event": {
          "fields": {
            "timeUs": {
              "type": "uint64",
              "id": 1
            },
            "eventType": {
              "type": "EventType",
              "id": 2
            },
            "packetNumber": {
              "type": "uint64",
              "id": 3
            },
            "frames": {
              "rule": "repeated",
              "type": "Frame",
              "id": 4
            },
            "packetSize": {
              "type": "uint64",
              "id": 5
            },
            "encryptionLevel": {
              "type": "EncryptionLevel",
              "id": 6
            },
            "transportState": {
              "type": "TransportState",
              "id": 7
            },
            "externalNetworkParameters": {
              "type": "ExternalNetworkParameters",
              "id": 8
            },
            "transmissionReason": {
              "type": "TransmissionReason",
              "id": 9,
              "options": {
                "default": "NORMAL_TRANSMISSION"
              }
            }
          }
        },
        "Trace": {
          "fields": {
            "protocolVersion": {
              "type": "bytes",
              "id": 1
            },
            "sourceConnectionId": {
              "type": "bytes",
              "id": 2
            },
            "destinationConnectionId": {
              "type": "bytes",
              "id": 3
            },
            "events": {
              "rule": "repeated",
              "type": "Event",
              "id": 4
            }
          }
        }
      }
    }
  }
};
