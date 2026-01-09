import { jsPDF } from 'jspdf';

const formatAmount = (value) => {
  const amount = Number(value || 0);
  return `INR ${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

const addHeader = (doc, title) => {
  doc.setFontSize(16);
  doc.setTextColor(156, 50, 83);
  doc.text('AOACON 2026', 105, 18, { align: 'center' });
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text(title, 105, 26, { align: 'center' });
  doc.setDrawColor(230);
  doc.line(20, 32, 190, 32);
};

const addLine = (doc, label, value, y) => {
  doc.setFontSize(10);
  doc.setTextColor(60);
  doc.text(`${label}:`, 20, y);
  doc.setTextColor(15);
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

export const buildRegistrationInvoicePdf = (registration, user) => {
  const doc = new jsPDF('p', 'mm', 'a4');
  addHeader(doc, 'Registration Invoice');

  let y = 42;
  addLine(doc, 'Invoice No', registration.registrationNumber || registration._id, y);
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
  doc.text('Registration Details', 20, y);
  y += 8;
  addLine(doc, 'Package', buildRegistrationLabel(registration), y);
  y += 6;
  addLine(doc, 'Booking Phase', registration.bookingPhase || 'N/A', y);
  y += 6;
  if (registration.selectedWorkshop) {
    addLine(doc, 'Workshop', registration.selectedWorkshop, y);
    y += 6;
  }
  y += 4;
  doc.setTextColor(0);
  doc.setFontSize(11);
  doc.text('Payment Summary', 20, y);
  y += 8;
  addLine(doc, 'Base Amount', formatAmount(registration.totalBase), y);
  y += 6;
  addLine(doc, 'GST', formatAmount(registration.totalGST), y);
  y += 6;
  addLine(doc, 'Processing Fee', formatAmount(registration.processingFee), y);
  y += 6;
  addLine(doc, 'Total Paid', formatAmount(registration.totalPaid || registration.totalAmount), y);
  y += 6;
  addLine(doc, 'Total Amount', formatAmount(registration.totalAmount), y);

  doc.setFontSize(9);
  doc.setTextColor(110);
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
