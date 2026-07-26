"use strict";

const net = require("node:net");

const patchMarker = Symbol.for("nexu.node-network-compat.setTypeOfService");
const socketPrototype = net.Socket.prototype;

if (
  typeof socketPrototype.setTypeOfService === "function" &&
  socketPrototype[patchMarker] !== true
) {
  const descriptor = Object.getOwnPropertyDescriptor(
    socketPrototype,
    "setTypeOfService",
  );
  const originalSetTypeOfService = socketPrototype.setTypeOfService;

  Object.defineProperty(socketPrototype, "setTypeOfService", {
    ...descriptor,
    value: function setTypeOfServiceWithMacOsFallback(typeOfService) {
      try {
        return originalSetTypeOfService.call(this, typeOfService);
      } catch (error) {
        const isValidTypeOfService =
          Number.isInteger(typeOfService) &&
          typeOfService >= 0 &&
          typeOfService <= 255;
        if (error?.code === "EINVAL" && isValidTypeOfService) {
          return this;
        }
        throw error;
      }
    },
  });
  Object.defineProperty(socketPrototype, patchMarker, {
    configurable: true,
    value: true,
  });
}
