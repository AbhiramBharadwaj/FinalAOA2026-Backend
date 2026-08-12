import Razorpay from 'razorpay';

export const RAZORPAY_KEY_ID =
  process.env.RAZORPAY_KEY_ID || 'rzp_live_S1h8EPxjXzDsaM';
export const RAZORPAY_KEY_SECRET =
  process.env.RAZORPAY_KEY_SECRET || 'sGAW1CE3Mnpus4PfYMdUAp8i';

export const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});
