import { jsPDF } from 'jspdf';

const formatAmount = (value) => {
  const amount = Number(value || 0);
  return `INR ${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

const BRAND = {
  primary: [0, 90, 169],
  accent: [156, 50, 83],
  light: [248, 250, 252],
  text: [32, 41, 57],
  muted: [100, 116, 139],
  line: [226, 232, 240],
};

const addHeader = (doc, title) => {
  doc.setFillColor(...BRAND.primary);
  doc.rect(0, 0, 210, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text('AOACON 2026', 20, 19);
  doc.setFontSize(10);
  doc.text('Shivamogga, Karnataka', 20, 26);
  doc.setFontSize(12);
  doc.text(title, 190, 19, { align: 'right' });

  doc.setFillColor(...BRAND.light);
  doc.rect(0, 30, 210, 18, 'F');
  doc.setTextColor(...BRAND.muted);
  doc.setFontSize(9);
  doc.text('19 NATIONAL CONFERENCE OF ASSOCIATION OF OBSTETRIC ANAESTHESIOLOGISTS, SHIVAMOGGA', 20, 42);
  doc.setDrawColor(...BRAND.line);
  doc.line(20, 48, 190, 48);
};

const addLine = (doc, label, value, y) => {
  doc.setFontSize(9);
  doc.setTextColor(...BRAND.muted);
  doc.text(`${label}:`, 20, y);
  doc.setTextColor(...BRAND.text);
  doc.text(String(value || 'N/A'), 60, y);
};

const buildRegistrationLabel = (registration) => {
  const labels = [];
  if (registration?.addWorkshop || registration?.selectedWorkshop) {
    labels.push('Workshop');
  }
  if (registration?.addAoaCourse) {
    labels.push('AOA Certified Course');
  }
  if (registration?.addLifeMembership) {
    labels.push('AOA Life Membership');
  }
  return labels.length ? `Conference + ${labels.join(' + ')}` : 'Conference Only';
};

const buildPaymentMeta = (registration, paymentMeta = {}) => {
  const paymentId = paymentMeta.paymentId || registration?.razorpayPaymentId || 'N/A';
  const paidAt = paymentMeta.paidAt || registration?.updatedAt || new Date();
  return { paymentId, paidAt };
};

const addSectionTitle = (doc, title, y) => {
  doc.setTextColor(...BRAND.accent);
  doc.setFontSize(11);
  doc.text(title, 20, y);
  doc.setDrawColor(...BRAND.line);
  doc.line(20, y + 2, 190, y + 2);
};

const addAmountRow = (doc, label, amount, y) => {
  doc.setFontSize(9);
  doc.setTextColor(...BRAND.muted);
  doc.text(label, 24, y);
  doc.setTextColor(...BRAND.text);
  doc.text(formatAmount(amount), 190, y, { align: 'right' });
};

export const buildRegistrationInvoicePdf = (registration, user, paymentMeta = {}) => {
  const doc = new jsPDF('p', 'mm', 'a4');
  addHeader(doc, 'Registration Invoice');

  const { paymentId, paidAt } = buildPaymentMeta(registration, paymentMeta);
  let y = 60;
  addLine(doc, 'Invoice No', registration.registrationNumber || registration._id, y);
  y += 6;
  addLine(doc, 'Payment Date', new Date(paidAt).toLocaleDateString('en-IN'), y);
  y += 6;
  addLine(doc, 'Name', user?.name, y);
  y += 6;
  addLine(doc, 'Email', user?.email, y);
  y += 6;
  if (user?.phone) {
    addLine(doc, 'Phone', user?.phone, y);
    y += 6;
  }
  addLine(doc, 'Payment ID / UTR', paymentId, y);
  y += 10;

  addSectionTitle(doc, 'Registration Details', y);
  y += 9;
  addLine(doc, 'Package', buildRegistrationLabel(registration), y);
  y += 6;
  addLine(doc, 'Booking Phase', registration.bookingPhase || 'N/A', y);
  y += 6;
  if (registration.selectedWorkshop) {
    addLine(doc, 'Workshop', registration.selectedWorkshop, y);
    y += 6;
  }
  y += 8;
  addSectionTitle(doc, 'Payment Breakdown', y);
  y += 8;

  const rowX = 20;
  const rowW = 170;
  const rowH = 7;
  const addRow = (label, amount, shaded = false) => {
    if (shaded) {
      doc.setFillColor(...BRAND.light);
      doc.rect(rowX, y - 5, rowW, rowH, 'F');
    }
    addAmountRow(doc, label, amount, y);
    y += 6;
  };

  addRow('Conference Base', registration.basePrice || 0, true);
  if (registration.workshopAddOn) addRow('Workshop Add-on', registration.workshopAddOn);
  if (registration.aoaCourseBase) addRow('AOA Certified Course', registration.aoaCourseBase, true);
  if (registration.lifeMembershipBase) addRow('AOA Life Membership', registration.lifeMembershipBase);
  addRow('Package Subtotal', registration.packageBase, true);
  addRow('GST (18%)', registration.totalGST);
  addRow('Processing Fee', registration.processingFee, true);

  y += 4;
  doc.setDrawColor(...BRAND.line);
  doc.line(20, y, 190, y);
  y += 6;
  doc.setFontSize(11);
  doc.setTextColor(...BRAND.text);
  doc.text('Total Paid', 20, y);
  doc.setTextColor(...BRAND.accent);
  doc.text(formatAmount(registration.totalPaid || registration.totalAmount), 190, y, {
    align: 'right',
  });

  doc.setFontSize(9);
  doc.setTextColor(...BRAND.muted);
  doc.text('Thank you for your participation.', 105, 270, { align: 'center' });

  return Buffer.from(doc.output('arraybuffer'));
};

export const buildAccommodationInvoicePdf = (booking, user) => {
  const doc = new jsPDF('p', 'mm', 'a4');
  addHeader(doc, 'Accommodation Invoice');

  let y = 42;
  addLine(doc, 'Invoice No', booking.bookingNumber || booking._id, y);
  y += 6;
  addLine(doc, 'Date', new Date().toLocaleDateString('en-IN'), y);
  y += 6;
  addLine(doc, 'Name', user?.name, y);
  y += 6;
  addLine(doc, 'Email', user?.email, y);
  y += 6;
  if (user?.phone) {
    addLine(doc, 'Phone', user?.phone, y);
    y += 6;
  }

  y += 4;
  doc.setTextColor(0);
  doc.setFontSize(11);
  doc.text('Booking Details', 20, y);
  y += 8;
  addLine(doc, 'Hotel', booking.accommodationId?.name || 'N/A', y);
  y += 6;
  addLine(doc, 'Location', booking.accommodationId?.location || 'N/A', y);
  y += 6;
  addLine(
    doc,
    'Check-in',
    booking.checkInDate ? new Date(booking.checkInDate).toLocaleDateString('en-IN') : 'N/A',
    y
  );
  y += 6;
  addLine(
    doc,
    'Check-out',
    booking.checkOutDate ? new Date(booking.checkOutDate).toLocaleDateString('en-IN') : 'N/A',
    y
  );
  y += 6;
  addLine(doc, 'Guests', booking.numberOfGuests, y);
  y += 6;
  addLine(doc, 'Rooms', booking.roomsBooked, y);
  y += 6;
  addLine(doc, 'Nights', booking.numberOfNights, y);

  y += 8;
  doc.setTextColor(0);
  doc.setFontSize(11);
  doc.text('Payment Summary', 20, y);
  y += 8;
  addLine(doc, 'Total Paid', formatAmount(booking.totalAmount), y);

  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text('Thank you for your participation.', 105, 270, { align: 'center' });

  return Buffer.from(doc.output('arraybuffer'));
};
