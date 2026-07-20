import { memo, useRef, useState } from '../../lib/teact/teact';
import { getActions } from '../../global';

import type { RegularLangKey } from '../../types/language';

import useFlag from '../../hooks/useFlag';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import InputText from '../ui/InputText';
import Modal from '../ui/Modal';

import styles from './TelethonSessionLogin.module.scss';

const API_HASH_LENGTH = 32;
const API_HASH_PATTERN = /^[a-f\d]+$/i;
const API_ID_PATTERN = /^\d+$/;
const SESSION_FILE_ACCEPT = '.session,.sqlite,.sqlite3,application/vnd.sqlite3';

const TelethonSessionLogin = () => {
  const { importTelethonSession } = getActions();

  const fileInputRef = useRef<HTMLInputElement>();
  const [file, setFile] = useState<File | undefined>();
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [errorKey, setErrorKey] = useState<RegularLangKey | undefined>();
  const [isUsingDefaultCredentials, setIsUsingDefaultCredentials] = useState(true);
  const [isModalOpen, openModal, closeModal] = useFlag();
  const [isLoading, markIsLoading, unmarkIsLoading] = useFlag();

  const lang = useLang();

  const handleCloseModal = useLastCallback(() => {
    if (isLoading) return;

    setErrorKey(undefined);
    setFile(undefined);
    setApiId('');
    setApiHash('');
    setIsUsingDefaultCredentials(true);
    closeModal();
  });

  const handleOpenFilePicker = useLastCallback(() => {
    fileInputRef.current!.click();
  });

  const handleFileChange = useLastCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0]);
    setErrorKey(undefined);
  });

  const handleDefaultCredentialsChange = useLastCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setIsUsingDefaultCredentials(e.target.checked);
    setErrorKey(undefined);
  });

  const handleApiIdChange = useLastCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setApiId(e.target.value);
    setErrorKey(undefined);
  });

  const handleApiHashChange = useLastCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setApiHash(e.target.value);
    setErrorKey(undefined);
  });

  const handleImport = useLastCallback(async () => {
    if (!file || isLoading) return;

    const trimmedApiId = apiId.trim();
    const trimmedApiHash = apiHash.trim();
    const parsedApiId = Number(trimmedApiId);
    const hasValidCustomCredentials = API_ID_PATTERN.test(trimmedApiId)
      && Number.isSafeInteger(parsedApiId)
      && parsedApiId > 0
      && trimmedApiHash.length === API_HASH_LENGTH
      && API_HASH_PATTERN.test(trimmedApiHash);

    if (!isUsingDefaultCredentials && !hasValidCustomCredentials) {
      setErrorKey('TelethonSessionInvalidCredentials');
      return;
    }

    markIsLoading();

    try {
      const { parseTelethonSession } = await import('../../util/telethonSession');
      const parsedSession = await parseTelethonSession(file);

      importTelethonSession({
        sessionData: {
          ...parsedSession,
          apiId: isUsingDefaultCredentials ? undefined : parsedApiId,
          apiHash: isUsingDefaultCredentials ? undefined : trimmedApiHash,
        },
      });
    } catch (err) {
      unmarkIsLoading();
      setErrorKey('TelethonSessionInvalidFile');
    }
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void handleImport();
  }

  return (
    <>
      <Button className="auth-button" isText onClick={openModal}>
        {lang('TelethonSessionLogin')}
      </Button>
      <Modal
        className={styles.root}
        isOpen={isModalOpen}
        isSlim
        hasCloseButton
        title={lang('TelethonSessionTitle')}
        onClose={handleCloseModal}
        onEnter={handleImport}
      >
        <form className={styles.form} onSubmit={handleSubmit}>
          <p className={styles.description}>{lang('TelethonSessionDescription')}</p>
          <input
            ref={fileInputRef}
            className={styles.fileInput}
            type="file"
            accept={SESSION_FILE_ACCEPT}
            aria-label={lang('TelethonSessionChooseFile')}
            onChange={handleFileChange}
          />
          <Button className={styles.fileButton} color="secondary" onClick={handleOpenFilePicker}>
            {lang('TelethonSessionChooseFile')}
          </Button>
          {file && <p className={styles.fileName} dir="auto">{file.name}</p>}
          <Checkbox
            id="telethon-session-default-api"
            className={styles.defaultCredentials}
            label={lang('TelethonSessionUseDefaultApi')}
            checked={isUsingDefaultCredentials}
            onChange={handleDefaultCredentialsChange}
          />
          {!isUsingDefaultCredentials && (
            <div className={styles.credentials}>
              <InputText
                id="telethon-session-api-id"
                label={lang('TelethonSessionApiId')}
                value={apiId}
                inputMode="numeric"
                onChange={handleApiIdChange}
              />
              <InputText
                id="telethon-session-api-hash"
                type="password"
                label={lang('TelethonSessionApiHash')}
                value={apiHash}
                maxLength={API_HASH_LENGTH}
                onChange={handleApiHashChange}
              />
            </div>
          )}
          {errorKey && <p className={styles.error}>{lang(errorKey)}</p>}
          <div className={styles.buttons}>
            <Button isText onClick={handleCloseModal}>{lang('Cancel')}</Button>
            <Button type="submit" isLoading={isLoading} disabled={!file}>
              {lang('TelethonSessionImport')}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
};

export default memo(TelethonSessionLogin);
