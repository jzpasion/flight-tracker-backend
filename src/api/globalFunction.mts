import { latLng } from "../interface/globalInterface.mjs";

// degrees to radian
const toRadians = (degrees: number) => {
  return (degrees * Math.PI) / 180;
};

// radian to degress
const toDegrees = (radians: number) => {
  return (radians * 180) / Math.PI;
};

//getting the radius
const destinationPoint = (
  lat: any,
  lon: any,
  distance: any,
  bearing: any
): latLng => {
  const R = 6371; // Earth radius in km
  const δ = distance / R; // Angular distance in radians
  const θ = toRadians(bearing);
  const φ1 = toRadians(lat);
  const λ1 = toRadians(lon);

  const sinφ1 = Math.sin(φ1);
  const cosφ1 = Math.cos(φ1);
  const sinδ = Math.sin(δ);
  const cosδ = Math.cos(δ);
  const sinθ = Math.sin(θ);
  const cosθ = Math.cos(θ);

  const sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * cosθ;
  const φ2 = Math.asin(sinφ2);

  const y = sinθ * sinδ * cosφ1;
  const x = cosδ - sinφ1 * sinφ2;
  const λ2 = λ1 + Math.atan2(y, x);

  const lon2 = ((toDegrees(λ2) + 540) % 360) - 180;
  const lat2 = toDegrees(φ2);

  return { lat: lat2, lon: lon2 };
};

const generateRandomColor = () => {
  const letters = "0123456789ABCDEF";
  let color = "#";
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 13)];
  }
  return color;
};

const flightColorMap: { [key: string]: string } = {};

const getFlightColor = (flightIdentifier: string): string => {
  if (!flightColorMap[flightIdentifier]) {
    flightColorMap[flightIdentifier] = generateRandomColor();
  }

  return flightColorMap[flightIdentifier];
};

export { destinationPoint, generateRandomColor, getFlightColor };
