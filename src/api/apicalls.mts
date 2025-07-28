import express from "express";
import axios from "axios";

const router = express.Router();

// get the airplanes from the given location and radius

router.get("location/:lat/:lon/:rad", async (req, res) => {
  const { lat } = req.params;
  const { lon } = req.params;
  const { rad } = req.params;
  try {
    const result = await axios.get(
      `https://api.adsb.lol/v2/point/${lat}/${lon}/${rad}`
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: "API error", details: err.message });
  }
});

// get flight details

router.get("flight/:flight", async (req, res) => {
  const { flight } = req.params;

  try {
    const result = await axios.get(
      ` https://api.aviationstack.com/v1/flights?access_key=1f6a4d26e87c06600395a124b651ca56&flight_iata=${flight}`
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: "API error", details: err.message });
  }
});

// export default router;
