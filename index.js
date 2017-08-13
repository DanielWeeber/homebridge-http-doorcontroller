var locks = require("locks");
var checkStateMutex = locks.createMutex();
var httpRequestMutex = locks.createMutex();

var request = require("request");
var Service, Accessory, Characteristic, DoorState;

module.exports = function(homebridge) {
	Service = homebridge.hap.Service;
	Accessory = homebridge.hap.Accessory;
	Characteristic = homebridge.hap.Characteristic;
	DoorState = homebridge.hap.Characteristic.LockCurrentState;

	uuid = homebridge.hap.uuid;
	homebridge.registerAccessory("homebridge-http-doorcontroller", "HttpDoorController", HttpDoorControllerAccessory);
}

function getConfigValue(config, key, defaultVal) {
	var val = config[key];

	if (val == null) {
		return defaultVal;
	}

	return val;
}


function HttpDoorControllerAccessory(log, config) {
	this.log = log;
	this.version = require("./package.json").version;
	log("Starting HttpDoorControllerAccessory v" + this.version);

	// Read and validate HTTP configuration
	var configurationValid = true;

	this.httpHost = getConfigValue(config, "httpHost", null);
	if (!this.httpHost) {
		this.log.error("ERROR - Missing or invalid configuration field 'httpHost'");
		configurationValid = false;
	}

	this.httpPort = parseInt(getConfigValue(config, "httpPort", 80)) || 0;
	if (!this.httpPort || (this.httpPort <= 0)) {
		this.log.error("ERROR - Missing or invalid configuration field 'httpPort'");
		configurationValid = false;
	}

	this.httpStatusPollMilliseconds = parseInt(getConfigValue(config, "httpStatusPollMilliseconds", 4000));
	if (!this.httpStatusPollMilliseconds || isNaN(this.httpStatusPollMilliseconds)) {
		this.log.error("ERROR - Missing or invalid configuration field 'httpStatusPollMilliseconds'");
		configurationValid = false;
	}

	this.httpRequestTimeoutMilliseconds = parseInt(getConfigValue(config, "httpRequestTimeoutMilliseconds", 10000));
	if (!this.httpRequestTimeoutMilliseconds || isNaN(this.httpRequestTimeoutMilliseconds)) {
		this.log.error("ERROR - Missing or invalid configuration field 'httpRequestTimeoutMilliseconds'");
		configurationValid = false;
	}

	this.httpHeaderName = getConfigValue(config, "httpHeaderName", null);
	if (this.httpHeaderName) {
		this.httpHeaderValue = getConfigValue(config, "httpHeaderValue", null);
		if (!this.httpHeaderValue) {
			this.log.error("ERROR - Missing or invalid configuration field 'httpHeaderValue' when 'httpHeaderName' is set");
			configurationValid = false;
		}
	}

	// Read and validate door configuration
	this.name = getConfigValue(config, "name", null);
	if (!this.name) {
		this.log.error("ERROR - Missing or invalid configuration field 'name'");
		configurationValid = false;
	}

	this.doorStateUrl = getConfigValue(config, "doorStateUrl", null);
	if (this.doorStateUrl) {
		this.doorStateField = getConfigValue(config, "doorStateField", null);
		if (!this.doorStateField) {
			this.log.error("ERROR - Missing or invalid configuration field 'doorStateField' when 'doorStateUrl' is set");
			configurationValid = false;
		}
	} else {
		this.doorOperationSeconds = parseInt(getConfigValue(config, "doorOperationSeconds", 0)) || 0;
		if (!this.doorOperationSeconds || (this.doorOperationSeconds <= 0)) {
			this.log.error("ERROR - Missing or invalid configuration field 'doorOperationSeconds' when 'doorStateUrl' is not set");
			configurationValid = false;
		}
	}
	// set doorOperationSeconds never the less, but only if it was not set before and >0
	if (!this.doorOperationSeconds && parseInt(getConfigValue(config, "doorOperationSeconds", 0))>0) {
	this.doorOperationSeconds = parseInt(getConfigValue(config, "doorOperationSeconds", 0));
	}
	
	this.doorOpenUrl = getConfigValue(config, "doorOperationCloseAfterOpenAuto", false);

	
	this.doorOpenUrl = getConfigValue(config, "doorOpenUrl", null);
	if (!this.doorOpenUrl) {
		this.log.error("ERROR - Missing or invalid configuration field 'doorOpenUrl'");
		configurationValid = false;
	}

	this.doorCloseUrl = getConfigValue(config, "doorCloseUrl", null);
	if (!this.doorCloseUrl) {
		this.log.error("ERROR - Missing or invalid configuration field 'doorCloseUrl'");
		configurationValid = false;
	}

	this.doorSuccessField = getConfigValue(config, "doorSuccessField", null);
	if (!this.doorSuccessField) {
		this.log.error("ERROR - Missing or invalid configuration field 'doorSuccessField'");
		configurationValid = false;
	}

	// Read and validate light configuration
	this.lightName = getConfigValue(config, "lightName", null);

	if (this.lightName) {
		this.lightStateUrl = getConfigValue(config, "lightStateUrl", null);
		if (this.lightStateUrl) {
			this.lightStateField = getConfigValue(config, "lightStateField", null);
			if (!this.lightStateField) {
				this.log.error("ERROR - Missing or invalid configuration field 'lightStateField' when 'lightStateUrl' is set");
				configurationValid = false;
			}
		}

		this.lightOnUrl = getConfigValue(config, "lightOnUrl", null);
		if (!this.lightOnUrl) {
			this.log.error("ERROR - Missing or invalid configuration field 'lightOnUrl' when 'lightName' is set");
			configurationValid = false;
		}

		this.lightOffUrl = getConfigValue(config, "lightOffUrl", null);
		if (!this.lightOffUrl) {
			this.log.error("ERROR - Missing or invalid configuration field 'lightOffUrl' when 'lightName' is set");
			configurationValid = false;
		}

		this.lightSuccessField = getConfigValue(config, "lightSuccessField", null);
		if (!this.lightSuccessField) {
			this.log.error("ERROR - Missing or invalid configuration field 'lightSuccessField'");
			configurationValid = false;
		}
	}

	if (configurationValid) {
		// Fully configured, initialise services
		this.initServices();
	}
}

HttpDoorControllerAccessory.prototype = {
	getServices: function() {
		this.log.debug("Entered getServices()");

		var availableServices = [];

		if (!this.accessoryInformationService) {
			this.accessoryInformationService = new Service.AccessoryInformation();
			this.accessoryInformationService.setCharacteristic(Characteristic.Manufacturer, "Daniel Weeber");
			this.accessoryInformationService.setCharacteristic(Characteristic.Model, "HttpDoorController");

			if (this.DoorService) {
				this.accessoryInformationService.setCharacteristic(Characteristic.SerialNumber, this.DoorService.UUID);
			}
		}

		availableServices.push(this.accessoryInformationService);

		if (this.DoorService) {
			availableServices.push(this.DoorService);
		}

		if (this.garageLightService) {
			availableServices.push(this.garageLightService);
		}

		return availableServices;
	},

	initServices: function() {
		this.log.debug("Entered initServices()");

		this.DoorService = new Service.LockMechanism(this.name);

		this.DoorCurrentState = this.DoorService.getCharacteristic(Characteristic.LockCurrentState);
		this.DoorCurrentState.on("get", this.getDoorCurrentState.bind(this));

		this.DoorTargetState = this.DoorService.getCharacteristic(Characteristic.LockTargetState);
		this.DoorTargetState.on("get", this.getDoorTargetState.bind(this));
		this.DoorTargetState.on("set", this.setDoorTargetState.bind(this));

		this._doorTargetState = DoorState.SECURED;
		this._doorCurrentState = DoorState.SECURED;
		this._setDoorCurrentState(this._doorCurrentState, true);

		if (this.lightName) {
			this.garageLightService = new Service.Lightbulb(this.lightName);

			this.garageLightCurrentState = this.garageLightService.getCharacteristic(Characteristic.On);
			this.garageLightCurrentState.on("get", this.getLightCurrentState.bind(this));
			this.garageLightCurrentState.on("set", this.setLightCurrentState.bind(this));

			this._lightCurrentState = false;
			this._setLightCurrentState(this._lightCurrentState, true);
		}
		
		if (this._hasStates()) {
			this._checkStates(true);
		}
	},

	getDoorCurrentState: function(callback) {
		this.log.debug("Entered getDoorCurrentState()");

		var error = null;
		if (this._hasStates() && ((Date.now() - this._doorCurrentStateSetAt) >= (this.httpStatusPollMilliseconds * 3))) {
			error = new Error("The Door current state is unknown (last known: " + this._doorStateToString(this._doorCurrentState) + "), it hasn't been reported since " + (new Date(this._doorCurrentStateSetAt)).toString());
			this.log.error(error.message);
		}

		callback(error, this._doorCurrentState);
	},

	getDoorTargetState: function(callback) {
		this.log.debug("Entered getDoorTargetState()");
		callback(null, this._doorTargetState);
	},

	setDoorTargetState: function(newState, callback) {
		this.log.debug("Entered setDoorTargetState(newState: %s)", this._doorStateToString(newState));

		if (this._doorTargetState == newState) {
			callback();
			return;
		}

		this.log.info("Received request to operate the Door: %s (currently: %s, target: %s)", this._doorStateToString(newState), this._doorStateToString(this._doorCurrentState), this._doorStateToString(this._doorTargetState));

		var that = this;
		this._httpRequest("GET", (newState == DoorState.UNSECURED ? this.doorOpenUrl : this.doorCloseUrl), this.doorSuccessField, true, function(error, response, json) {
			if (error) {
				var error = new Error("ERROR in setDoorTargetState() - " + error.message);
				that.log.error(error.message);
				callback(error);
				return;
			}

			that._setDoorTargetState(newState);
			
			
			if (newState == DoorState.UNSECURED && that.doorOperationSeconds && that.doorOperationCloseAfterOpenAuto) {
				var begin=Date.now();
				that.log.info("Entered setDoorTargetState.BeforeTimeoutEnds");
				setTimeout(function() { 
					var end= Date.now();
					var timeSpent=(end-begin)/1000+"secs";
					that.log.info("Entered setDoorTargetState.AfterTimeoutEnds. Timeout was %s",timeSpent);
					
					that.setDoorTargetState(DoorState.SECURED);
					
					
					
				},that.doorOperationSeconds * 1000);
			}
/* funktioniert, aber komische HomeKit Meldung

			if (newState == DoorState.UNSECURED && that.doorOperationSeconds && that.doorOperationCloseAfterOpenAuto) {
				var begin=Date.now();
				that.log.info("Entered setDoorTargetState.BeforeTimeoutEnds");
				setTimeout(function() { 
					var end= Date.now();
					var timeSpent=(end-begin)/1000+"secs";
					that.log.info("Entered setDoorTargetState.AfterTimeoutEnds. Timeout was %s",timeSpent);
					
					that._httpRequest("GET", that.doorCloseUrl, that.doorSuccessField, true, function(error, response, json) {
						if (error) {
							var error = new Error("ERROR in setDoorTargetState.AfterTimeoutEnds() - " + error.message);
							that.log.error(error.message);
							callback(error);
							return;
						}

					that._setDoorTargetState(newState);
						
					});
					
					
					
				},that.doorOperationSeconds * 1000);
			}
*/
			
		/*
			// When no status is available, create a callback to set current state to target state after the specified amount of time
			if (!that._hasDoorState()) {
				var setDoorTargetStateFinal = function() {
					this._setDoorCurrentState(this._doorTargetState);
				};

				setTimeout(setDoorTargetStateFinal.bind(that), that.doorOperationSeconds * 1000);
			}
		*/	
			callback();
		});
	},
	
	getLightCurrentState: function(callback) {
		this.log.debug("Entered getLightCurrentState()");

		var error = null;
		if (this._hasStates() && ((Date.now() - this._lightCurrentStateSetAt) >= (this.httpStatusPollMilliseconds * 3))) {
			error = new Error("The Garage Light current state is unknown (last known: " + this._lightStateToString(this._lightCurrentState) + "), it hasn't been reported since " + (new Date(this._lightCurrentStateSetAt)).toString());
			this.log.error(error.message);
		}

		callback(error, this._lightCurrentState);
	},

	setLightCurrentState: function(newState, callback) {
		this.log.debug("Entered setLightCurrentState(newState: %s)", newState);

		if (this._lightCurrentState == newState) {
			callback();
			return;
		}

		this.log.info("Received request to operate the Garage Light: %s (currently: %s)", this._lightStateToString(newState), this._lightStateToString(this._lightCurrentState));

		var that = this;
		this._httpRequest("PUT", (newState ? this.lightOnUrl : this.lightOffUrl), this.lightSuccessField, true, function(error, response, json) {
			if (error) {
				var error = new Error("ERROR in setLightCurrentState() - " + error.message);
				that.log.error(error.message);
				callback(error);
				return;
			}

			that._setLightCurrentState(newState);
			callback();
		});
	},

	_checkStates: function(initial) {
		this.log.debug("Entered _checkStates(initial: %s)", (initial || false));

		var that = this;

		if (this._hasDoorState()) {
			checkStateMutex.lock(function() {
				that._determineDoorState(function(error, doorState, lightState) {
					if (error) {
						that.log.error("ERROR in _checkStates() - " + error.message);
					} else {
						that._setDoorCurrentState(doorState, initial);

						if (lightState != null) {
							that._setLightCurrentState(lightState, initial);
						}
					}
					
					checkStateMutex.unlock();
				});
			});
		}

		// If the door state and light state share the same API, the light state will have been set above
		if (this._hasLightState() && (this.doorStateUrl != this.lightStateUrl)) {
			checkStateMutex.lock(function() {
				that._determineLightState(function(error, lightState) {
					if (error) {
						that.log.error("ERROR in _checkStates() - " + error.message);
					} else {
						that._setLightCurrentState(lightState, initial);
					}
					
					checkStateMutex.unlock();
				});
			});
		}

		checkStateMutex.lock(function() {
			setTimeout(that._checkStates.bind(that), that.httpStatusPollMilliseconds);
			checkStateMutex.unlock();
		});
	},

	_determineDoorState: function(done) {
		this.log.debug("Entered _determineDoorState()");

		if (!this._hasDoorState()) {
			done(null, this._doorCurrentState);
			return;
		}

		var that = this;
		this._httpRequest("GET", this.doorStateUrl, this.doorStateField, null, function(error, response, json) {
			if (error) {
				done(new Error("ERROR in _determineDoorState() - " + error.message + this.doorStateUrl));
				return;
			}

			var doorState = that._doorStateToState(json[that.doorStateField]);

			if (doorState == null) {
				done(new Error("ERROR in _determineDoorState() - The JSON field value of the HTTP response was unexpected: " + json[that.doorStateField]));
				return;
			}

			// If the door state and light state share the same API, return the light state too
			var lightState = null;

			if (that._hasLightState() && (that.doorStateUrl == that.lightStateUrl) && json.hasOwnProperty(that.lightStateField)) {
				lightState = (json[that.lightStateField] == true);
			}

			done(null, doorState, lightState);
		});
	},

	_determineLightState: function(done) {
		this.log.debug("Entered _determineLightState()");

		if (!this._hasLightState()) {
			done(null, this._lightCurrentState);
			return;
		}

		var that = this;
		that._httpRequest("GET", this.lightStateUrl, this.lightStateField, null, function(error, response, json) {
			if (error) {
				done(new Error("ERROR in _determineLightState() - " + error.message));
				return;
			}

			var lightState = (json[that.lightStateField] == true);
			done(null, lightState);
		});
	},

	_setDoorCurrentState: function(state, initial, isFromTargetState) {
		this.log.debug("Entered _setDoorCurrentState(state: %s, initial: %s, isFromTargetState: %s)", this._doorStateToString(state), (initial || false), (isFromTargetState || false));
		this._doorCurrentStateSetAt = Date.now();
		
		if ((this._doorCurrentState == state) && (!initial)) {
			return;
		}

		this.log.info("%s Door state is: %s", (initial ? "INITIAL" : "NEW"), this._doorStateToString(state));

		this._doorCurrentState = state;
		this.DoorCurrentState.setValue(this._doorCurrentState);

		if (!isFromTargetState) {
			if ((state == DoorState.UNSECURED) || (state == DoorState.OPENING)) {
				this._setDoorTargetState(DoorState.UNSECURED, initial, true);
			} else if ((state == DoorState.SECURED) || (state == DoorState.CLOSING)) {
				this._setDoorTargetState(DoorState.SECURED, initial, true);
			}
		}
	},

	_setDoorTargetState: function(state, initial, isFromCurrentState) {
		this.log.debug("Entered _setDoorTargetState(state: %s, initial: %s, isFromCurrentState: %s)", this._doorStateToString(state), (initial || false), (isFromCurrentState || false));
		this._doorTargetStateSetAt = Date.now();

		if ((this._doorTargetState == state) && (!initial)) {
			return;
		}

		this.log.info("%s Door target state is: %s", (initial ? "INITIAL" : "NEW"), this._doorStateToString(state));

		this._doorTargetState = state;
		this.DoorTargetState.setValue(this._doorTargetState);

		if (!isFromCurrentState) {
			if (state == DoorState.UNSECURED) {
				this._setDoorCurrentState(DoorState.UNSECURED, initial, true);
			} else if (state == DoorState.SECURED) {
				this._setDoorCurrentState(DoorState.SECURED, initial, true);
			}
		}
	},

	_setLightCurrentState: function(state, initial) {
		this.log.debug("Entered _setLightCurrentState(state: %s, initial: %s)", state, (initial || false));
		this._lightCurrentStateSetAt = Date.now();

		if ((this._lightCurrentState == state) && (!initial)) {
			return;
		}

		this.log.info("%s Garage Light state is: %s", (initial ? "INITIAL" : "NEW"), this._lightStateToString(state));

		this._lightCurrentState = state;
		this.garageLightCurrentState.setValue(this._lightCurrentState);
	},

	_doorStateToString: function(doorState) {
		switch (doorState) {
			case DoorState.UNSECURED:
				return "OPEN";
			case DoorState.SECURED:
				return "CLOSED";
			case DoorState.OPENING:
				return "OPENING";
			case DoorState.CLOSING:
				return "CLOSING";
			case DoorState.STOPPED:
				return "STOPPED";
			default:
				return "UNKNOWN";
		}
	},

	_lightStateToString: function(lightState) {
		if (lightState) {
			return "ON";
		} else {
			return "OFF";
		}
	},

	_doorStateToState: function(doorState) {
		switch (doorState.toUpperCase()) {
			case "OPEN":
				return DoorState.UNSECURED;
			case "CLOSED":
				return DoorState.SECURED;
			case "OPENING":
				return DoorState.UNSECURED;
			case "CLOSING":
				return DoorState.SECURED;
			case "UNKNOWN":
			case "STOPPED":
			case "STOPPED-OPENING":
			case "STOPPED-CLOSING":
				return DoorState.SECURED;
			default:
				return null;
		}
	},

	_hasStates: function() {
		return (this._hasDoorState() || this._hasLightState());
	},

	_hasDoorState: function() {
		return (this.doorStateUrl != null);
	},
	
	_hasdoorCloseAfterOperationSeconds: function() {
		return (this.doorCloseAfterOperationSeconds != null);
	},

	_hasLightState: function() {
		return (this.lightStateUrl != null);
	},

	_httpRequest: function(method, url, expectedJsonField, expectedJsonFieldValue, done) {
		httpRequestMutex.lock(function() {
			var options = {
				method: method,
				timeout: this.httpRequestTimeoutMilliseconds,
				url: "http://" + this.httpHost + ((this.httpPort == 80) ? "" : ":" + this.httpPort) + url
			};

			if (this.httpHeaderName) {
				var headers = {};
				headers[this.httpHeaderName] = this.httpHeaderValue;
				options.headers = headers;
			}

			var that = this;
			this.log.debug("Requesting HTTP Door Controller URI '%s'...", url);

			var req = request(options, function(error, response, body) {
				var json = null;

				if (error) {
					that.log.debug("Request failed! - %s", error.message);
					error = new Error("An error occurred during the HTTP request: " + error.message);
				} else {
					that.log.debug("Request completed!");

					if ((response.statusCode < 200) || (response.statusCode > 299)) {
						error = new Error("The status code of the HTTP response was unexpected: " + response.statusCode);
					} else {
						try {
							json = JSON.parse(body);
						} catch (jsonError) {
							json = null;
							that.log(body);
							error = new Error("The JSON body of the HTTP response could not be parsed: " + jsonError.message);
						}

						if ((json != null) && (expectedJsonField != null)) {
							if (!json.hasOwnProperty(expectedJsonField)) {
								error = new Error("The JSON body of the HTTP response does not contain the field: " + expectedJsonField);
							} else if ((expectedJsonFieldValue != null) && (json[expectedJsonField] != expectedJsonFieldValue)) {
								error = new Error("The JSON field value of the HTTP response was unexpected: 1JsonField:" + json[expectedJsonField] + " 2JsonFieldValue" + expectedJsonFieldValue + " 3expectedJsonFieldValue" + expectedJsonFieldValue);
							}
						}
					}
				}
			req.end();

				httpRequestMutex.unlock();
				done(error, response, ((json != null) ? json : body));
			});
		}.bind(this));
	}
};
