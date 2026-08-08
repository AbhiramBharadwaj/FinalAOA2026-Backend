const FIELD_LABELS = {
  email: 'Email',
  phone: 'Phone number',
  membershipId: 'AOA Membership ID',
  pincode: 'Pincode',
  registrationNumber: 'Registration number',
  selectedWorkshop: 'Workshop selection',
};

const fieldLabel = (field = 'value') =>
  FIELD_LABELS[field] ||
  String(field)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\.]+/g, ' ')
    .replace(/^./, (character) => character.toUpperCase());

const getDuplicateField = (error) =>
  Object.keys(error?.keyPattern || error?.keyValue || {})[0];

const getDuplicateMessage = (error) => {
  const field = getDuplicateField(error);
  if (field === 'email') return 'This email is already registered. Please sign in or use another email.';
  if (field === 'phone') return 'This phone number is already registered. Please sign in or use another number.';
  if (field === 'membershipId') return 'This AOA Membership ID is already registered. Please check the ID or sign in.';
  return `${fieldLabel(field)} is already in use. Please enter a different value.`;
};

const getValidationMessage = (error) => {
  const entries = Object.entries(error?.errors || {});
  if (!entries.length) return 'Please check the entered information and try again.';

  const [field, validationError] = entries[0];
  const detail = validationError?.message || 'is invalid';
  return `${fieldLabel(field)}: ${detail}`;
};

export const getSafeErrorResponse = (
  error,
  fallbackMessage = 'We could not complete this request. Please try again.'
) => {
  if (error?.name === 'ValidationError') {
    return { status: 400, message: getValidationMessage(error) };
  }

  if (error?.code === 11000) {
    return { status: 400, message: getDuplicateMessage(error) };
  }

  if (error?.name === 'CastError') {
    return {
      status: 400,
      message: `${fieldLabel(error.path)} is invalid. Please check it and try again.`,
    };
  }

  if (error?.name === 'MulterError') {
    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? 'The selected file is too large. Please choose a smaller file.'
        : `File upload failed: ${error.message}`;
    return { status: 400, message };
  }

  return { status: 500, message: fallbackMessage };
};

export const sendErrorResponse = (res, error, fallbackMessage) => {
  const response = getSafeErrorResponse(error, fallbackMessage);
  return res.status(response.status).json({ message: response.message });
};
